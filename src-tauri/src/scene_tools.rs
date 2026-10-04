use serde_json::{json, Value};

pub fn definitions() -> Value {
    let tool = |name: &str, description: &str, properties: Value, required: Value| {
        json!({
            "type":"function","name":name,"description":description,"strict":true,
            "parameters":{"type":"object","properties":properties,"required":required,"additionalProperties":false}
        })
    };
    json!([{"type":"namespace","name":"studio","description":"Read and edit the current Tana Studio scene and asset library. Positions and collision checks are resolved by the scene engine; edits support Undo.","tools":[
        tool("get_scene","Read the live scene, objects, characters, camera, timeline and named placement anchors.",json!({}),json!([])),
        tool("list_library","List all current prop and character assets, including imported models and their IDs and dimensions.",json!({}),json!([])),
        tool("find_placements","Find clear locations for a library asset. Prefer camera_foreground if the user did not specify a location. Does not change the scene.",json!({"asset_id":{"type":"string"},"anchor":{"type":["string","null"]}}),json!(["asset_id","anchor"])),
        tool("apply_action","Apply one typed Rixse action from the current scene vocabulary. Provide the action type and its JSON-encoded payload. Rixse validates fields, resolves entity handles, checks placement and records an undoable edit. Only claim success after ok:true.",json!({"type":{"type":"string","description":"Action name from the Rixse vocabulary, e.g. place_asset, move_prop or delete_prop."},"payload":{"type":"string","description":"JSON object matching that action's parameters, e.g. {\"asset_id\":\"a12\",\"anchor\":\"camera_foreground\",\"rotation_y\":0}. Coordinates and offsets are scalar x/y/z and dx/dy/dz."}}),json!(["type","payload"]))
    ]}])
}

pub fn validate_continuation(items: &[Value]) -> Result<(), String> {
    if items.len() > 200
        || serde_json::to_vec(items).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024
    {
        return Err("This agent turn is too long. Start a new request.".into());
    }
    for item in items {
        let valid = match item["type"].as_str() {
            Some("reasoning") => true,
            Some("message") => item["role"] == "assistant",
            Some("function_call") => {
                item["call_id"].is_string()
                    && item["name"].is_string()
                    && item["arguments"].is_string()
            }
            Some("function_call_output") => {
                item["call_id"].is_string() && item["output"].is_string()
            }
            _ => false,
        };
        if !valid {
            return Err("Invalid agent continuation.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stateless_tool_continuation_preserves_reasoning_and_results_but_rejects_privileged_messages()
    {
        assert!(validate_continuation(&[
            json!({"type":"reasoning","encrypted_content":"opaque"}),
            json!({"type":"function_call","call_id":"1","name":"apply_action","arguments":"{}"}),
            json!({"type":"function_call_output","call_id":"1","output":"{\"ok\":true}"}),
            json!({"type":"message","role":"assistant","content":[]}),
        ])
        .is_ok());
        for item in [
            json!({"type":"message","role":"system"}),
            json!({"type":"function_call","name":"apply_action"}),
            json!({"type":"computer_call"}),
        ] {
            assert!(validate_continuation(&[item]).is_err());
        }
        assert!(validate_continuation(&vec![json!({"type":"reasoning"}); 201]).is_err());
    }

    #[test]
    fn chatgpt_tools_are_namespaced_and_edits_use_the_rixse_action_vocabulary() {
        let tools = definitions();
        assert_eq!(tools[0]["type"], "namespace");
        assert_eq!(tools[0]["name"], "studio");
        let actions = tools[0]["tools"].as_array().unwrap();
        assert!(actions
            .iter()
            .any(|a| a["name"] == "apply_action" && a["strict"] == true));
        assert!(!actions.iter().any(|a| a["name"] == "execute_code"));
    }
}
