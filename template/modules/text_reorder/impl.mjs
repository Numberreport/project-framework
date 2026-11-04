export function transform(text) {
  const parts = (text.match(/[^。！？]+[。！？]?/g) || [])
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text.trim();
  return parts[0] + parts.slice(1).reverse().join('');
}
