import { join } from 'node:path';

// Blender loads vendor GPU drivers only when those rendering backends are used.
// Keep the optional Blender modules, but don't try to package host GPU drivers.
export function linuxBundleEnv(environment, runtime, blenderVersion) {
  const version = blenderVersion.split('.').slice(0, 2).join('.');
  return {
    ...environment,
    LINUXDEPLOY_EXCLUDED_LIBRARIES: [
      environment.LINUXDEPLOY_EXCLUDED_LIBRARIES,
      'libamdhip64.so.*', 'libze_loader.so.*', 'libcuda.so.*',
      // Optional MaterialX Python render bindings reference backend libraries
      // that are absent from the pinned upstream bpy wheel itself.
      'libMaterialXGenMdl.so.*', 'libMaterialXGenOsl.so.*',
      'libMaterialXRenderGlsl.so.*', 'libMaterialXRenderOsl.so.*',
    ].filter(Boolean).join(';'),
    // These wheel libraries resolve their siblings at import time. linuxdeploy
    // also needs their search paths while inspecting each ELF file individually.
    LD_LIBRARY_PATH: [
      join(runtime, 'lib/python3.11/site-packages/numpy.libs'),
      join(runtime, `lib/python3.11/site-packages/bpy/${version}/python/lib/python3.11/site-packages/MaterialX`),
      environment.LD_LIBRARY_PATH,
    ].filter(Boolean).join(':'),
  };
}
