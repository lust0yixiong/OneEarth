// Apply the public source name to display copies, keeping stored identities usable.
export function literatureText(text: string): string {
  return text.replace(
    /https?:\/\/[^\s"'<>]+|earthnano:[a-f0-9]{64}|(?:EarthNano\s*[·-]?\s*)?(?:论文)?断言库|EarthNano/gi,
    match => /^(?:https?:\/\/|earthnano:)/i.test(match) ? match : "文献资料",
  );
}

export function literatureDisplay<T>(value: T): T {
  if (typeof value === "string") return literatureText(value) as T;
  if (Array.isArray(value)) return value.map(literatureDisplay) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, literatureDisplay(item)])) as T;
  return value;
}
