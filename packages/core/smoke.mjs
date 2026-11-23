import { ToolkitBackend, Model, standardLibrary } from 'sysml';
const backend = await ToolkitBackend.open({
  sources: { 'a.sysml': 'package P { part def A; }' },
  libraryDir: await standardLibrary(),
});
const model = new Model(backend);
console.log('roots:', model.roots().length);   // 1: package P
backend.close();
