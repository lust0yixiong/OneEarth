// Explicit exploration windows; coordinates label the actual filter in the UI.
const windows: Record<string, readonly [number, number, number, number]> = {
  阿尔卑斯窗口: [5, 43.5, 16.5, 48],
  阿拉斯加南部窗口: [-154, 55, -131, 64],
};
export function matchesPlace(
  place: string,
  label: string,
  point?: readonly number[],
) {
  if (!place) return true;
  const box = windows[place];
  if (!box) return label.toLowerCase().includes(place.toLowerCase());
  return (
    !!point &&
    point[0] >= box[0] &&
    point[0] <= box[2] &&
    point[1] >= box[1] &&
    point[1] <= box[3]
  );
}
export function regionLabel(place: string) {
  const box = windows[place];
  return box
    ? place +
        "（经度 " +
        box[0] +
        " 至 " +
        box[2] +
        "°，纬度 " +
        box[1] +
        " 至 " +
        box[3] +
        "°）"
    : place;
}
