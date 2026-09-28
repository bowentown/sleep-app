/**
 * SSRF 防护：自定义 AI 服务端地址（用户可填）必须是 HTTPS，且不得指向本机、
 * 内网、链路本地或云元数据服务。
 *
 * 抽成独立模块的原因：此前它内联在 server.ts 里，而 server.ts 在导入时会
 * 直接 app.listen()，导致这段安全逻辑无法被自动化测试覆盖。
 */

/** 私网 / 保留地址前缀（IPv4） */
const BLOCKED_V4_PREFIXES = [
  '0.', // 0.0.0.0/8
  '10.', // 10.0.0.0/8
  '127.', // 127.0.0.0/8 整个回环段——原实现只精确匹配 127.0.0.1，127.0.0.2 等可绕过
  '169.254.', // 链路本地（含云元数据 169.254.169.254）
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.', // 172.16.0.0/12
  '192.168.', // 192.168.0.0/16
];

/** 私网 / 保留地址前缀（IPv6）。
 *  '::' 覆盖 ::1（回环）、::（未指定）以及 ::ffff:7f00:1 这类 IPv4 映射地址——
 *  原实现只精确匹配 ::1 与 0:0:0:0:0:0:0:1，映射写法可绕过。 */
const BLOCKED_V6_PREFIXES = [
  '::', // 未指定地址、回环 ::1、IPv4 映射 ::ffff:127.0.0.1
  'fe80:', // 链路本地
  'fc00:', // 唯一本地
  'fd00:', // 唯一本地
];

export function isSafeHttpsUrl(urlString?: string): boolean {
  if (!urlString) return false;
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // 去掉 IPv6 方括号

    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      return false;
    }

    // 以下两条是防御性兜底：WHATWG URL 解析器其实已经会把 2130706433 /
    // 0x7f000001 / 017700000001 / 127.1 全部规范化成 127.0.0.1（被上面的
    // 127. 前缀命中），所以这里目前拦不到额外的东西。保留是为了万一
    // hostname 将来来自 URL 之外的来源（例如手写的 host 头）。
    if (/^\d+$/.test(hostname)) return false;
    if (hostname.startsWith('0x') || /^0\d+(\.|$)/.test(hostname)) return false;

    // 仅当 hostname 确实是 IPv4 字面量时才套用网段前缀，否则会把
    // "10.example.com" 这类正常域名误判成内网地址。WHATWG URL 已把所有
    // 数值型写法（127.1 / 整数 / 十六进制 / 八进制）规范化成点分四段，
    // 所以这个形状判断是可靠的。
    const isIpv4Literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
    if (isIpv4Literal && BLOCKED_V4_PREFIXES.some((p) => hostname.startsWith(p))) return false;
    // IPv6 字面量一定含 ':'，域名不可能含，所以无需额外形状判断
    if (hostname.includes(':') && BLOCKED_V6_PREFIXES.some((p) => hostname.startsWith(p))) return false;

    return true;
  } catch {
    return false;
  }
}
