// Solar position for Mong Kok, 17 July 2025, UTC+8.
const latitude = 22.3193 * Math.PI / 180;
const longitude = 114.1694;
const declination = 21.1 * Math.PI / 180;
const equationOfTime = -6.0;
const solarNoon = 12 * 60 - 4 * (longitude - 120) - equationOfTime;
const horizon = -0.833 * Math.PI / 180;
const daylightHalf = Math.acos((Math.sin(horizon) - Math.sin(latitude) * Math.sin(declination)) /
  (Math.cos(latitude) * Math.cos(declination))) * 720 / Math.PI;

export const sunrise = Math.round(solarNoon - daylightHalf) * 60;
export const sunset = Math.round(solarNoon + daylightHalf) * 60;
export const timeLabel = (seconds, precise = false) => {
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60];
  if (precise) parts.push(Math.floor(seconds) % 60);
  return parts.map(value => String(value).padStart(2, '0')).join(':');
};

export function sunAt(seconds) {
  const angle = (seconds / 60 - solarNoon) * Math.PI / 720;
  return [
    -Math.cos(declination) * Math.sin(angle),
    Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(angle),
    Math.sin(latitude) * Math.cos(declination) * Math.cos(angle) - Math.cos(latitude) * Math.sin(declination)
  ];
}

export function buildReplay(crowd, key) {
  const frames = crowd.frames[key];
  return {
    limit: Math.max(1, ...frames.map(frame => frame.length)),
    positions(seconds) {
      const index = Math.floor((seconds - crowd.frame_start) / crowd.frame_step);
      return frames[index] || [];
    }
  };
}
