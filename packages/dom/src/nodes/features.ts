/** Whether the DOM has a feature at a version: Core and XML, at Levels 1 to 3 (DOM Level 3 `hasFeature`). */
export function hasFeature(feature: string, version: string | null): boolean {
  const name = feature.replace(/^\+/, '').toLowerCase();
  if (name !== 'core' && name !== 'xml') return false;
  return (
    version === null ||
    version === '' ||
    version === '3.0' ||
    version === '2.0' ||
    (version === '1.0' && name === 'xml')
  );
}
