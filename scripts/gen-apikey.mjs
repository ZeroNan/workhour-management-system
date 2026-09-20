// 生成开放接口 API Key（首次对接 WPS 前使用）
// 用法（在项目根目录）：
//   node scripts/gen-apikey.mjs "WPS集成" 120
// 说明：依赖 .env 中的数据库连接；密钥明文仅本次打印，系统只存 SHA-256 哈希。
import { createKey } from '../src/services/integrationService.js';

const name = process.argv[2] || 'WPS集成';
const rateLimit = Number(process.argv[3]) || 120;

const k = await createKey({ name, rateLimit });
console.log('\n✅ API Key 已生成（明文仅此一次显示，请妥善保存）：\n');
console.log('  ' + k.key + '\n');
console.log(JSON.stringify(k, null, 2));
process.exit(0);
