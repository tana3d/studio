//! Embedded Zega stores personal metadata. Model files remain portable on disk.
use crate::library::{plain, read_asset, valid_id, SavedAsset};
use serde_json::{json, Value};
use std::{fs, path::Path, sync::Mutex};
use zega::Zega;

const SCHEMA: &str = r#"schema {
  type LibraryAsset {
    assetId: String name: String category: String sha256: String
    tags: String animations: String catalog: String
    creator: String licence: String source: String animationCount: Int
    model: String width?: Float depth?: Float height?: Float
  }
} unique { LibraryAsset { assetId } }"#;
const FIELDS: &str = "assetId name category sha256 tags animations catalog width depth height";
static COLLECTION: Mutex<Option<Collection>> = Mutex::new(None);

pub struct Collection {
    db: Zega,
    skipped: usize,
}
impl Collection {
    fn open(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        plain(dir)?;
        let path = dir.join(".zega");
        if path.exists() {
            plain(&path)?;
        }
        let db = Zega::open(path.to_str().ok_or("Invalid collection path.")?)
            .wal_flush_every_write()
            .build()
            .map_err(|e| e.to_string())?;
        let mut collection = Self { db, skipped: 0 };
        // One startup reconciliation also recovers a download interrupted after
        // publishing files but before its metadata commit. Existing graph rows win.
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let id = entry.file_name().to_string_lossy().to_string();
            if id.starts_with('.') {
                continue;
            }
            match read_asset(dir, &id) {
                Ok(asset) => {
                    if collection.get(&id)?.is_none() {
                        collection.put(&asset)?;
                    }
                }
                Err(_) => collection.skipped += 1,
            }
        }
        Ok(collection)
    }
    pub fn get(&self, id: &str) -> Result<Option<SavedAsset>, String> {
        valid_id(id)?;
        let row = self
            .db
            .run_lang_read(
                SCHEMA,
                &format!(
                    "query {{ LibraryAsset(assetId: {}) {{ {FIELDS} }} }}",
                    json!(id)
                ),
            )
            .map_err(|e| e.to_string())?;
        if row.is_null() {
            return Ok(None);
        }
        decode(row).map(Some)
    }
    pub fn list(&self) -> Result<(Vec<SavedAsset>, usize), String> {
        let rows = self
            .db
            .run_lang_read(SCHEMA, &format!("query {{ LibraryAsset {{ {FIELDS} }} }}"))
            .map_err(|e| e.to_string())?;
        let mut assets: Vec<_> = rows
            .as_array()
            .ok_or("Invalid collection query.")?
            .iter()
            .cloned()
            .map(decode)
            .collect::<Result<_, _>>()?;
        assets.sort_by_cached_key(|asset| asset.name.to_lowercase());
        Ok((assets, self.skipped))
    }
    pub fn put(&self, asset: &SavedAsset) -> Result<(), String> {
        valid_id(&asset.id)?;
        let catalog = asset.catalog.as_ref().unwrap_or(&Value::Null);
        let mut fields = vec![
            ("name", json!(asset.name)),
            ("category", json!(asset.category)),
            ("sha256", json!(asset.sha256)),
            (
                "tags",
                json!(serde_json::to_string(&asset.tags).map_err(|e| e.to_string())?),
            ),
            (
                "animations",
                json!(serde_json::to_string(&asset.animations).map_err(|e| e.to_string())?),
            ),
            (
                "catalog",
                json!(serde_json::to_string(&asset.catalog).map_err(|e| e.to_string())?),
            ),
            ("creator", json!(catalog["creator"].as_str().unwrap_or(""))),
            ("licence", json!(catalog["license"].as_str().unwrap_or(""))),
            (
                "source",
                json!(catalog["source_url"].as_str().unwrap_or("")),
            ),
            ("animationCount", json!(asset.animations.len())),
            ("model", json!(format!("{}/model.glb", asset.id))),
            ("width", json!(asset.footprint.map(|v| v[0]))),
            ("depth", json!(asset.footprint.map(|v| v[1]))),
            ("height", json!(asset.height)),
        ];
        let statement = if self.get(&asset.id)?.is_some() {
            let sets = fields
                .iter()
                .map(|(name, value)| format!("{name}: {value}"))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "mutation {{ LibraryAsset(assetId: {}) set {sets} }}",
                json!(asset.id)
            )
        } else {
            fields.push(("assetId", json!(asset.id)));
            let values = fields
                .iter()
                .map(|(name, value)| format!("{name}: {value}"))
                .collect::<Vec<_>>()
                .join(" && ");
            format!("mutation {{ LibraryAsset({values}) }}")
        };
        self.db
            .run_lang(SCHEMA, &statement)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
fn decode(row: Value) -> Result<SavedAsset, String> {
    let text = |key: &str| {
        row[key]
            .as_str()
            .ok_or_else(|| format!("Invalid collection field: {key}."))
    };
    let width = row["width"].as_f64();
    let depth = row["depth"].as_f64();
    Ok(SavedAsset {
        id: text("assetId")?.into(),
        name: text("name")?.into(),
        category: text("category")?.into(),
        sha256: text("sha256")?.into(),
        tags: serde_json::from_str(text("tags")?).map_err(|e| e.to_string())?,
        animations: serde_json::from_str(text("animations")?).map_err(|e| e.to_string())?,
        catalog: serde_json::from_str(text("catalog")?).map_err(|e| e.to_string())?,
        footprint: width.zip(depth).map(|(w, d)| [w, d]),
        height: row["height"].as_f64(),
    })
}
pub fn with<T>(
    dir: &Path,
    job: impl FnOnce(&Collection) -> Result<T, String>,
) -> Result<T, String> {
    let mut state = COLLECTION.lock().map_err(|e| e.to_string())?;
    if state.is_none() {
        *state = Some(Collection::open(dir)?);
    }
    job(state.as_ref().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrates_manifests_once_and_persists_graph_updates_across_reopen() {
        let mut random = [0u8; 8];
        getrandom::getrandom(&mut random).unwrap();
        let dir = std::env::temp_dir().join(format!("tana-zega-{}", u64::from_le_bytes(random)));
        fs::create_dir_all(dir.join("robot")).unwrap();
        let mut asset = SavedAsset {
            id: "robot".into(),
            name: "Robot \"Wave\"".into(),
            category: "characters".into(),
            tags: vec!["robot".into()],
            animations: vec!["Idle".into(), "Wave".into()],
            catalog: Some(
                json!({"creator":"Sami", "license":"CC0", "source_url":"https://tana.gg"}),
            ),
            footprint: None,
            height: None,
            sha256: "verified-hash".into(),
        };
        fs::write(
            dir.join("robot/asset.json"),
            serde_json::to_vec(&asset).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("robot/model.glb"), b"placeholder").unwrap();
        {
            let collection = Collection::open(&dir).unwrap();
            assert_eq!(collection.list().unwrap().0.len(), 1);
            asset.name = "Updated robot".into();
            asset.footprint = Some([0.64, 0.72]);
            asset.height = Some(1.85);
            collection.put(&asset).unwrap();
            collection.put(&asset).unwrap();
            let row = collection.db.run_lang_read(SCHEMA, "query { LibraryAsset(category: \"characters\") { name animationCount creator licence } }").unwrap();
            assert_eq!(row["name"], "Updated robot");
            assert_eq!(row["animationCount"], 2);
            assert_eq!(row["licence"], "CC0");
        }
        let reopened = Collection::open(&dir).unwrap();
        assert_eq!(reopened.list().unwrap().0.len(), 1);
        let saved = reopened.get("robot").unwrap().unwrap();
        assert_eq!(saved.name, "Updated robot");
        assert_eq!(saved.footprint, Some([0.64, 0.72]));
        assert_eq!(saved.animations, asset.animations);
        drop(reopened);
        fs::remove_dir_all(dir).unwrap();
    }
}
