const fs = require('node:fs/promises'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
const validId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, JSON.stringify(value), { flush: true });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
async function entries(dir) {
  await fs.mkdir(dir, { recursive: true });
  const names = await fs.readdir(dir);
  return (
    await Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .map(async (n) => {
          try {
            return {
              ...JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')),
              id: n.slice(0, -5),
            };
          } catch {
            return null;
          }
        }),
    )
  ).filter(Boolean);
}
function createStorage(root, session = randomUUID()) {
  const recoveries = path.join(root, 'recovery'),
    presets = path.join(root, 'styles');
  let writes = Promise.resolve();
  const queue = (fn) => {
    const result = writes.then(fn);
    writes = result.catch(() => {});
    return result;
  };
  return {
    autosave: (record) =>
      queue(() =>
        atomic(path.join(recoveries, session + '.json'), {
          ...record,
          savedAt: new Date().toISOString(),
        }),
      ),
    clear: () =>
      queue(() =>
        fs.unlink(path.join(recoveries, session + '.json')).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        }),
      ),
    recoveries: async () =>
      (await entries(recoveries))
        .filter(
          (r) =>
            r.id !== session &&
            validId(r.id) &&
            r.project?.version === 1 &&
            typeof r.savedAt === 'string',
        )
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    recovery: async (id) => {
      if (!validId(id)) throw Error('Invalid recovery.');
      return JSON.parse(await fs.readFile(path.join(recoveries, id + '.json'), 'utf8'));
    },
    discard: async (id) => {
      if (!validId(id)) throw Error('Invalid recovery.');
      await fs.unlink(path.join(recoveries, id + '.json'));
    },
    presets: async () =>
      (await entries(presets)).filter(
        (r) =>
          validId(r.id) && typeof r.name === 'string' && r.style && typeof r.style === 'object',
      ),
    savePreset: async (name, style, id) => {
      if (id && !validId(id)) throw Error('Invalid preset.');
      const record = { id: id || randomUUID(), name: String(name).trim().slice(0, 80), style };
      if (!record.name) throw Error('Give your preset a name.');
      await atomic(path.join(presets, record.id + '.json'), record);
      return record;
    },
    deletePreset: async (id) => {
      if (!validId(id)) throw Error('Invalid preset.');
      await fs.unlink(path.join(presets, id + '.json'));
    },
  };
}
module.exports = { createStorage };
