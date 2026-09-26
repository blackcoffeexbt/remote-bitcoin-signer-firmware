const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Keep the normal development scheme and add a standalone, bundled device run.
module.exports = function withDeviceScheme(config) {
  return withDangerousMod(config, ['ios', async config => {
    const name = config.modRequest.projectName;
    const directory = path.join(config.modRequest.platformProjectRoot,
      `${name}.xcodeproj`, 'xcshareddata', 'xcschemes');
    const source = await fs.readFile(path.join(directory, `${name}.xcscheme`), 'utf8');
    const device = source.replace(/(<LaunchAction\s+buildConfiguration = )"Debug"/, '$1"Release"');
    if (device === source && !/<LaunchAction\s+buildConfiguration = "Release"/.test(source)) {
      throw new Error('Cannot configure the standalone iPhone scheme');
    }
    await fs.writeFile(path.join(directory, `${name}Device.xcscheme`), device);
    return config;
  }]);
};
