const block = /```interfaces\s*\r?\n([\s\S]*?)\r?\n```/g;

export function validatePorts(ports) {
  if (!Array.isArray(ports)) throw Error('接口定义必须是数组');
  const names = new Set();
  for (const port of ports) {
    if (!port || typeof port.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(port.name)) throw Error('接口名称只能用字母、数字、下划线和短横线');
    if (names.has(port.name)) throw Error('同一方向的接口名称重复：' + port.name);
    if (typeof port.description !== 'string' || !port.description.trim()) throw Error('接口须填写要求：' + port.name);
    names.add(port.name);
  }
  return ports;
}

export function readPorts(text) {
  const matches = [...text.matchAll(block)];
  if (matches.length > 1) throw Error('接口定义只能有一块');
  if (!matches.length) return null;
  return validatePorts(JSON.parse(matches[0][1]));
}

export function writePorts(text, ports) {
  validatePorts(ports);
  const section = '```interfaces\n' + JSON.stringify(ports, null, 2) + '\n```';
  readPorts(text);
  return readPorts(text) === null ? text.trimEnd() + '\n\n' + section + '\n' : text.replace(block, () => section);
}
