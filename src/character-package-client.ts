export { CHARACTER_PACKAGE_MAX_BYTES as MAX_CHARACTER_BACKUP_BYTES } from '../packages/character-package/contract';
const modules = import.meta.glob<typeof import('../packages/character-package')>('../packages/character-package/index.ts');
export async function characterPackageModule() {
  const importer = modules['../packages/character-package/index.ts'];
  if (!importer) throw new Error('角色备份模块尚未就绪，请稍后重试。');
  return importer();
}
