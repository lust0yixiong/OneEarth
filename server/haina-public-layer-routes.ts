/** Public, read-only paths for the three verified Haina layer pilots. */
export const hainaPublicLayerRoute =
  /^\/visualizations\/haina\/(?:1835839|1835833|1846104)\/public-v1\/[a-z0-9][a-z0-9_.-]{0,139}\.(?:json|geojson|png|webp)$/;

export const hainaViirsRoute =
  /^\/visualizations\/haina\/1835833\/global-v1\/(?:(?<manifest>manifest\.json)|tile\/(?<tileRevision>[a-f0-9]{64})\/(?<z>\d{1,2})\/(?<x>\d{1,4})\/(?<y>\d{1,4})\.png|sample\/(?<sampleRevision>[a-f0-9]{64}))$/;

export const hainaXuannvCoverageRoute =
  /^\/visualizations\/haina\/1846104\/coverage-v1\/(?:manifest\.json|frame\/[a-f0-9]{64}\/patch_\d{6}\/\d{4}-(?:0[1-9]|1[0-2])\.png)$/;
