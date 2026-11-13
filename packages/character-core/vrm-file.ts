import type { MotionCapabilities } from './motion-capabilities';

export const MAX_MODEL_BYTES = 64 * 1024 * 1024;
export interface ModelInfo {
  name: string;
  authors: string[];
  version: string;
  expressions: string[];
  licenseUrl: string;
  avatarPermission: string;
  allowRedistribution: boolean;
  motionCapabilities?: MotionCapabilities;
}

/** Reject external references before GLTFLoader can issue a request. */
export function inspectVrmFile(buffer: ArrayBuffer): ModelInfo {
  if (buffer.byteLength > MAX_MODEL_BYTES) throw new Error('模型不能超过 64 MiB。');
  if (buffer.byteLength < 28) throw new Error('文件不完整，请选择二进制 .vrm 模型。');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('这不是有效的 GLB / VRM 文件。');
  }
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('文件长度与 GLB 声明不一致。');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length % 4 || length > buffer.byteLength - 20) {
    throw new Error('模型的 JSON 数据块无效。');
  }
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)).trim()); }
  catch { throw new Error('无法读取模型元数据。'); }
  const modern = doc.extensions?.VRMC_vrm;
  const legacy = doc.extensions?.VRM;
  const isModern = modern && typeof modern.specVersion === 'string' && modern.specVersion.startsWith('1.');
  const isLegacy = legacy && legacy.specVersion === '0.0';
  if (!isModern && !isLegacy) throw new Error('请选择 VRM 0.0 或 VRM 1.0 模型。');
  if ([...(doc.buffers ?? []), ...(doc.images ?? [])].some((item) => item.uri !== undefined)) {
    throw new Error('仅接受纹理与数据全部内嵌的 VRM，模型不能引用外部文件或网络地址。');
  }
  if ((doc.nodes?.length ?? 0) > 5000) throw new Error('模型节点过多，请先简化模型。');
  if (!isModern) {
    const meta = legacy.meta ?? {};
    const groups = Array.isArray(legacy.blendShapeMaster?.blendShapeGroups) ? legacy.blendShapeMaster.blendShapeGroups : [];
    return {
      name: typeof meta.title === 'string' && meta.title ? meta.title : '未命名角色',
      authors: typeof meta.author === 'string' && meta.author ? [meta.author] : [],
      version: '0.0',
      expressions: groups.map((group: { presetName?: unknown }) => group?.presetName).filter((name: unknown): name is string => typeof name === 'string' && name !== 'unknown'),
      licenseUrl: typeof meta.otherLicenseUrl === 'string' ? meta.otherLicenseUrl : '',
      avatarPermission: String(meta.allowedUserName ?? '未知'),
      allowRedistribution: false,
    };
  }
  const meta = modern.meta ?? {};
  return {
    name: typeof meta.name === 'string' ? meta.name : '未命名角色',
    authors: Array.isArray(meta.authors) ? meta.authors.filter((v: unknown) => typeof v === 'string') : [],
    version: String(modern.specVersion),
    expressions: Object.keys(modern.expressions?.preset ?? {}),
    licenseUrl: typeof meta.licenseUrl === 'string' ? meta.licenseUrl : '',
    avatarPermission: String(meta.avatarPermission ?? '未知'),
    allowRedistribution: meta.allowRedistribution === true,
  };
}
