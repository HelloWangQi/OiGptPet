const floatBuffer = Buffer.alloc(32);
for (const [index, value] of [0, 1, 0, 1, 0, 0, 1.25, 0].entries()) {
  floatBuffer.writeFloatLE(value, index * 4);
}

const document = {
  asset: { version: '2.0', generator: 'OiGptPet smoke fixture' },
  extensionsUsed: ['VRMC_vrm_animation'],
  extensions: {
    VRMC_vrm_animation: {
      specVersion: '1.0',
      humanoid: { humanBones: { hips: { node: 0 } } },
    },
  },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ translation: [0, 1, 0], name: 'Hips' }],
  buffers: [{ byteLength: floatBuffer.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 8 },
    { buffer: 0, byteOffset: 8, byteLength: 24 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
    { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' },
  ],
  animations: ['升降测试', '升降测试副本'].map(name => ({
    name,
    samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
    channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
  })),
};

const json = Buffer.from(JSON.stringify(document));
const jsonLength = Math.ceil(json.length / 4) * 4;
const binaryLength = Math.ceil(floatBuffer.length / 4) * 4;
const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
const glb = Buffer.alloc(totalLength);
let offset = 0;
glb.writeUInt32LE(0x46546c67, offset); offset += 4;
glb.writeUInt32LE(2, offset); offset += 4;
glb.writeUInt32LE(totalLength, offset); offset += 4;
glb.writeUInt32LE(jsonLength, offset); offset += 4;
glb.writeUInt32LE(0x4e4f534a, offset); offset += 4;
json.copy(glb, offset); glb.fill(0x20, offset + json.length, offset + jsonLength); offset += jsonLength;
glb.writeUInt32LE(binaryLength, offset); offset += 4;
glb.writeUInt32LE(0x004e4942, offset); offset += 4;
floatBuffer.copy(glb, offset);

export function createSmokeVrma() { return glb; }
