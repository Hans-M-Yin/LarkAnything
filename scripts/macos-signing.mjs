// Explicit modes: never silently downgrade a signed release to ad-hoc.
export function macSigningEnvironment(input) {
  const env = { ...input };
  const mode = env.MACOS_SIGNING_MODE || 'adhoc';
  if (!['adhoc', 'developer-id'].includes(mode)) throw new Error('MACOS_SIGNING_MODE must be adhoc or developer-id');
  const required = ['APPLE_SIGNING_IDENTITY', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'];
  if (mode === 'developer-id') {
    const missing = required.filter(key => !env[key]?.trim());
    if (missing.length) throw new Error(`Developer ID release requires: ${missing.join(', ')}`);
    if (!env.APPLE_SIGNING_IDENTITY.startsWith('Developer ID Application:')) throw new Error('Use a Developer ID Application signing identity');
  } else {
    for (const key of required) delete env[key];
    env.APPLE_SIGNING_IDENTITY = '-';
  }
  // This pipeline intentionally uses app-specific-password notarization only.
  for (const key of ['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH']) delete env[key];
  env.MACOS_SIGNING_MODE = mode;
  return env;
}
