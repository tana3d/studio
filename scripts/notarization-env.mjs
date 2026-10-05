// Tauri tests whether variables exist, so even empty Apple-ID variables can mask API-key auth.
export function notarizationEnv(environment) {
  const env={...environment};
  if(env.APPLE_API_KEY&&env.APPLE_API_ISSUER&&env.APPLE_API_KEY_PATH) {
    delete env.APPLE_ID;delete env.APPLE_PASSWORD;
  } else {
    for(const key of ['APPLE_ID','APPLE_PASSWORD','APPLE_API_KEY','APPLE_API_ISSUER','APPLE_API_KEY_PATH'])if(!env[key])delete env[key];
  }
  return env;
}
