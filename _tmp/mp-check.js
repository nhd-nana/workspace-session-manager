// 临时：探明 gallery API 里哪个 filterType 能按「扩展名」精确查询
// 用法: node _tmp/mp-check.js <extension-name>
const name = process.argv[2];

async function q(filterType) {
    const body = {
        filters: [{ criteria: [{ filterType, value: name }], pageNumber: 1, pageSize: 20 }],
        assetTypes: [],
        flags: 914,
    };
    try {
        const r = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json;api-version=7.2-preview.1',
            },
            body: JSON.stringify(body),
        });
        const j = await r.json();
        const es = j?.results?.[0]?.extensions ?? [];
        return { filterType, n: es.length, ids: es.map((e) => `${e.publisher.publisherName}.${e.extensionName}`) };
    } catch (e) {
        return { filterType, err: e.message };
    }
}

(async () => {
    // filterType 10 = 模糊搜索（唯一可用的）；再按名字精确比对
    async function exactOf(key, value) {
        const body = {
            filters: [{ criteria: [{ filterType: 10, value }], pageNumber: 1, pageSize: 50 }],
            assetTypes: [],
            flags: 914,
        };
        const r = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.2-preview.1' },
            body: JSON.stringify(body),
        });
        const j = await r.json();
        const es = j?.results?.[0]?.extensions ?? [];
        return es.filter((e) => String(e[key] ?? '').toLowerCase() === value.toLowerCase());
    }

    for (const cand of process.argv.slice(2)) {
        const asName = await exactOf('extensionName', cand);
        const asDisplay = await exactOf('displayName', cand);
        const busy = asName.length || asDisplay.length;
        const detail = [
            asName.length ? `name 撞: ${asName.map((e) => `${e.publisher.publisherName}.${e.extensionName}`).join(', ')}` : '',
            asDisplay.length ? `displayName 撞: ${asDisplay.map((e) => `${e.publisher.publisherName}.${e.extensionName}`).join(', ')}` : '',
        ].filter(Boolean).join(' | ');
        console.log(`${busy ? '❌' : '✅'} ${cand}  ${detail}`);
    }
})();
