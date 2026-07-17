import { AudioLines } from "lucide-react";
import type { AudioInputDeviceSummary } from "./types";

export interface AudioInputSelectProps {
  id: string;
  devices: AudioInputDeviceSummary[];
  selectedDeviceId: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  selectClassName?: string;
  showIcon?: boolean;
}

export function AudioInputSelect(props: AudioInputSelectProps) {
  const {
    id,
    devices,
    selectedDeviceId,
    onChange,
    disabled = false,
    label = "Audio In",
    className,
    iconClassName,
    labelClassName,
    selectClassName,
    showIcon = false,
  } = props;

  const defaultDevices = devices.filter((device) => device.source === "default");
  const systemDevices = devices.filter((device) => device.source === "system");
  const microphoneDevices = devices.filter((device) => device.source !== "default" && device.source !== "system");

  return (
    <div className={className} data-no-global-ptt="true">
      {showIcon ? <AudioLines className={iconClassName} aria-hidden="true" /> : null}
      <label className={labelClassName} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={selectClassName}
        value={selectedDeviceId}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {defaultDevices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
        {microphoneDevices.length ? (
          <optgroup label="Microphones">
            {microphoneDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {systemDevices.length ? (
          <optgroup label="Mac audio / virtual inputs">
            {systemDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </div>
  );
}
