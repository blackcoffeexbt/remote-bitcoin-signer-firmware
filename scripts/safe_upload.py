"""Use the selected platform's esptool and detect the serial port for app-only upload."""
from pathlib import Path

Import("env")

esptool = Path(env.PioPlatform().get_package_dir("tool-esptoolpy")) / "esptool.py"
env.Replace(SAFE_ESPTOOL=str(esptool))


def detect_port(source, target, env):
    env.AutodetectUploadPort()


env.AddPreAction("upload", detect_port)
