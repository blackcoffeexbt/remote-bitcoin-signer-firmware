const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withActivityLintWorkaround(config) {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    const activity = manifest.application?.[0]?.activity?.find(
      item => item.$['android:name'] === '.MainActivity',
    );
    if (!activity) throw new Error('MainActivity missing from Android manifest');
    // SDK 57's release lint misidentifies the inherited Kotlin/AndroidX chain.
    // Verified compiled public no-arg MainActivity -> ReactActivity ->
    // AppCompatActivity -> FragmentActivity -> activity.ComponentActivity ->
    // core.app.ComponentActivity -> android.app.Activity. Keep every other
    // release lint check enabled; revisit this exception on dependency updates.
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const ignored = new Set((activity.$['tools:ignore'] || '').split(',').filter(Boolean));
    ignored.add('Instantiatable');
    activity.$['tools:ignore'] = [...ignored].join(',');
    return config;
  });
};
