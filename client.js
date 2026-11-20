window.__ModuleLoader__.load({
  id: 'dsh-prompt-studio',
  factory(require) {
    const react = require('react');
    const { jsx, jsxs } = require('react/jsx-runtime');
    require('@deepseek-ai/cordis');

    /* ── 预设编辑面板 ────────────────────────────────────────────────────
       侧边栏「预设」→ 列出全部 agent preset（来源标记：profile-patch /
       bundle），点一个展开编辑：名称、描述、order、system prompt（persona
       prefix/suffix）。保存直接写回 profile patch（注释保留），live 重载后
       新建会话使用新提示词。底部可「从模板新建 preset」。               */

    const PANEL_ID = 'preset-studio';
    const NS = 'presetStudio';

    const CSS = [
      '.pe-root{flex:1 1 auto;height:100%;min-height:0;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.5;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,inherit)}',
      '.pe-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.pe-title{font-weight:600;font-size:14px}',
      '.pe-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary,inherit)}',
      '.pe-badge.on{background:var(--dsw-alias-state-success-bg,rgba(16,185,129,.12));color:var(--dsw-alias-state-success-primary,#10b981)}',
      '.pe-badge.warn{background:rgba(234,179,8,.15);color:#b45309}',
      '.pe-actions{margin-left:auto;display:flex;gap:8px}',
      '.pe-btn{border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-secondary,inherit);border-radius:6px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;transition:all .15s}',
      '.pe-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3,transparent));color:var(--dsw-alias-label-primary,inherit)}',
      '.pe-btn.primary{background:var(--dsw-alias-button-primary-fill,#4176e6);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}',
      '.pe-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,#3564cc);filter:none}',
      '.pe-btn:disabled{opacity:.5;cursor:default;filter:none}',
      '.pe-hint{font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.pe-path{font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,inherit));font-family:ui-monospace,monospace;word-break:break-all}',
      '.pe-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#dc2626);background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:8px 12px;white-space:pre-wrap}',
      '.pe-ok{font-size:12px;color:var(--dsw-alias-state-success-primary,#10b981);background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:8px;padding:8px 12px;white-space:pre-wrap}',
      '.pe-empty{text-align:center;padding:40px 20px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.pe-list{display:flex;flex-direction:column;gap:8px}',
      '.pe-card{border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2));border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);overflow:hidden}',
      '.pe-card.open{border-color:var(--dsw-alias-link,#4176e6)}',
      '.pe-card-head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none}',
      '.pe-name{font-weight:600;font-size:13px;white-space:nowrap}',
      '.pe-id{font-size:10px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,inherit));font-family:monospace}',
      '.pe-order{font-size:10px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,inherit))}',
      '.pe-spacer{flex:1}',
      '.pe-card-body{border-top:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2));padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.05))}',
      '.pe-field{display:flex;flex-direction:column;gap:4px}',
      '.pe-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,inherit)}',
      '.pe-field input[type="text"],.pe-field input[type="number"]{border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));border-radius:6px;background:var(--dsw-alias-bg-base,transparent);color:inherit;font:inherit;font-size:12px;padding:6px 9px;outline:none;box-sizing:border-box}',
      '.pe-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));border-radius:6px;background:var(--dsw-alias-bg-base,transparent);color:inherit;font:inherit;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5;padding:8px 10px;outline:none;resize:vertical}',
      '.pe-field input:focus,.pe-field textarea:focus{border-color:var(--dsw-alias-link,#4176e6)}',
      '.pe-field.prefix textarea{min-height:240px;max-height:56vh}',
      '.pe-field.suffix textarea{min-height:64px;max-height:18vh}',
      '.pe-row2{display:flex;gap:12px}',
      '.pe-row2>*{flex:1;min-width:0}',
      '.pe-card-actions{display:flex;align-items:center;gap:8px}',
      '.pe-compaction{border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.25));border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1,transparent)}',
      '.pe-compaction-title{font-weight:600;font-size:12px;display:flex;align-items:center;gap:8px}',
      '.pe-check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer}',
      '.pe-check input{width:14px;height:14px}',
      '.pe-create{border:1px dashed var(--dsw-alias-border-l3,rgba(127,127,127,.4));border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.pe-create-title{font-weight:600;font-size:12px;display:flex;align-items:center;gap:8px}',
      '.pe-icon{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center}',
    ].join('\n');

    let styleInserted = false;
    function ensureStyles() {
      if (styleInserted) return;
      styleInserted = true;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-prompt-studio';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    async function jsonFetch(url, init) {
      try {
        const response = await fetch(url, { credentials: 'same-origin', ...(init ?? {}) });
        let data = null;
        try { data = await response.json(); } catch { /* non-JSON */ }
        if (!response.ok) return { ok: false, error: data?.error ?? `HTTP ${response.status}` };
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    }

    const post = (url, payload) => jsonFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });

    /** The preset authoring panel. */
    function PresetPanel() {
      const [state, setState] = react.useState({ loading: true, error: null, presets: [], patchPath: '' });
      const [openId, setOpenId] = react.useState(null);
      const [draft, setDraft] = react.useState(null);
      const [busy, setBusy] = react.useState(false);
      const [notice, setNotice] = react.useState(null);
      const [compaction, setCompaction] = react.useState(null);
      const [createOpen, setCreateOpen] = react.useState(false);
      const [createDraft, setCreateDraft] = react.useState({ id: '', name: '', order: '', baseId: 'standard', personaPrefix: '', personaSuffix: '' });

      const load = react.useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        const result = await jsonFetch('/preset-studio/list');
        if (!result.ok) { setState((prev) => ({ ...prev, loading: false, error: result.error })); return; }
        setState({ loading: false, error: null, presets: result.data.presets ?? [], patchPath: result.data.patchPath ?? '' });
      }, []);

      react.useEffect(() => { load(); }, [load]);

      const openEditor = (preset) => {
        if (openId === preset.id) { setOpenId(null); setDraft(null); setCompaction(null); return; }
        setOpenId(preset.id);
        setCompaction(null);
        jsonFetch(`/preset-studio/compaction?id=${encodeURIComponent(preset.id)}`).then((result) => {
          if (result.ok && result.data?.found) setCompaction({ ...result.data.config, engine: result.data.engine });
        });
        setDraft({
          name: preset.name ?? '',
          description: preset.description ?? '',
          order: preset.order === null || preset.order === undefined ? '' : String(preset.order),
          personaPrefix: preset.personaPrefix ?? '',
          personaSuffix: preset.personaSuffix ?? '',
        });
        setNotice(null);
      };

      const save = async () => {
        if (!openId || !draft) return;
        setBusy(true);
        setNotice(null);
        const result = await post('/preset-studio/save', {
          id: openId,
          name: draft.name,
          description: draft.description,
          ...(draft.order === '' ? {} : { order: Number(draft.order) }),
          personaPrefix: draft.personaPrefix,
          personaSuffix: draft.personaSuffix,
        });
        if (!result.ok) { setBusy(false); setNotice({ kind: 'error', text: result.error }); return; }
        let compactionNote = '';
        if (compaction) {
          const compResult = await post('/preset-studio/compaction', {
            id: openId,
            alwaysCompact: compaction.alwaysCompact === true,
            summaryOnly: compaction.summaryOnly === true,
            keepRounds: Number(compaction.keepRounds) || 0,
            remindOnRound: compaction.remindOnRound === '' || compaction.remindOnRound == null ? null : Number(compaction.remindOnRound),
            ...(compaction.reminder === undefined || compaction.reminder === null ? {} : { reminder: String(compaction.reminder) }),
            alwaysMinSpanTokens: Number(compaction.alwaysMinSpanTokens) || 1024,
            retainTokens: Number(compaction.retainTokens) || 4096,
          });
          if (!compResult.ok) { setBusy(false); setNotice({ kind: 'error', text: `预设已保存，但压缩参数保存失败：${compResult.error}` }); await load(); return; }
          compactionNote = '，压缩参数已保存';
        }
        setBusy(false);
        setNotice({ kind: 'ok', text: `已写入 profile patch${compactionNote}，live 重载已触发。新建会话生效（当前会话不变）。` });
        await load();
      };

      const create = async () => {
        setBusy(true);
        setNotice(null);
        const result = await post('/preset-studio/create', {
          id: createDraft.id.trim(),
          name: createDraft.name.trim(),
          order: createDraft.order === '' ? 9 : Number(createDraft.order),
          baseId: createDraft.baseId,
          personaPrefix: createDraft.personaPrefix,
          personaSuffix: createDraft.personaSuffix,
        });
        setBusy(false);
        if (!result.ok) { setNotice({ kind: 'error', text: result.error }); return; }
        setNotice({ kind: 'ok', text: `预设 "${createDraft.id.trim()}" 已创建。新建会话可在 preset 菜单里选择它。` });
        setCreateDraft({ id: '', name: '', order: '', baseId: 'standard', personaPrefix: '', personaSuffix: '' });
        setCreateOpen(false);
        await load();
      };

      if (state.loading && state.presets.length === 0) {
        return jsx('div', { className: 'pe-root', children: jsx('div', { className: 'pe-empty', children: '加载预设…' }) });
      }
      if (state.error) {
        return jsx('div', { className: 'pe-root', children: jsx('div', { className: 'pe-error', children: state.error }) });
      }

      return jsxs('div', { className: 'pe-root', children: [
        jsxs('div', { className: 'pe-header', children: [
          jsx('span', { className: 'pe-title', children: 'Agent 预设' }),
          jsx('span', { className: 'pe-badge', children: `${state.presets.length} 个` }),
          jsxs('div', { className: 'pe-actions', children: [
            jsx('button', { type: 'button', className: 'pe-btn', onClick: load, disabled: state.loading, children: state.loading ? '刷新中…' : '刷新' }),
            jsx('button', { type: 'button', className: 'pe-btn primary', onClick: () => setCreateOpen(!createOpen), children: createOpen ? '收起新建' : '新建预设' }),
          ] }),
        ] }),
        jsx('div', { className: 'pe-hint', children: '点一个预设展开编辑它的 system prompt（persona prefix/suffix）。保存写入 profile patch 并热重载——新会话生效，当前会话不变。' }),
        jsx('div', { className: 'pe-path', children: state.patchPath }),
        notice ? jsx('div', { className: notice.kind === 'ok' ? 'pe-ok' : 'pe-error', children: notice.text }) : null,

        createOpen ? jsxs('div', { className: 'pe-create', children: [
          jsx('div', { className: 'pe-create-title', children: '新建预设' }),
          jsxs('div', { className: 'pe-row2', children: [
            jsx('label', { className: 'pe-field', children: [
              jsx('span', { className: 'pe-label', children: '预设 id（小写字母/数字/连字符）' }),
              jsx('input', { type: 'text', value: createDraft.id, onChange: (e) => setCreateDraft({ ...createDraft, id: e.target.value }) }),
            ] }),
            jsx('label', { className: 'pe-field', children: [
              jsx('span', { className: 'pe-label', children: '显示名称' }),
              jsx('input', { type: 'text', value: createDraft.name, onChange: (e) => setCreateDraft({ ...createDraft, name: e.target.value }) }),
            ] }),
            jsx('label', { className: 'pe-field', children: [
              jsx('span', { className: 'pe-label', children: 'order' }),
              jsx('input', { type: 'number', value: createDraft.order, onChange: (e) => setCreateDraft({ ...createDraft, order: e.target.value }) }),
            ] }),
          ] }),
          jsx('label', { className: 'pe-field', children: [
            jsx('span', { className: 'pe-label', children: '模板（复制其工具组成）' }),
            jsx('select', {
              value: createDraft.baseId,
              onChange: (e) => setCreateDraft({ ...createDraft, baseId: e.target.value }),
              children: state.presets.map((preset) => jsx('option', { value: preset.id, children: `${preset.name} (${preset.id})` })),
            }),
          ] }),
          jsx('label', { className: 'pe-field prefix', children: [
            jsx('span', { className: 'pe-label', children: 'system prompt — persona prefix' }),
            jsx('textarea', { value: createDraft.personaPrefix, spellCheck: false, onChange: (e) => setCreateDraft({ ...createDraft, personaPrefix: e.target.value }) }),
          ] }),
          jsx('label', { className: 'pe-field suffix', children: [
            jsx('span', { className: 'pe-label', children: 'persona suffix' }),
            jsx('textarea', { value: createDraft.personaSuffix, spellCheck: false, onChange: (e) => setCreateDraft({ ...createDraft, personaSuffix: e.target.value }) }),
          ] }),
          jsxs('div', { className: 'pe-card-actions', children: [
            jsx('button', { type: 'button', className: 'pe-btn primary', onClick: create, disabled: busy || createDraft.id.trim() === '' || createDraft.name.trim() === '', children: busy ? '创建中…' : '创建预设' }),
            jsx('button', { type: 'button', className: 'pe-btn', onClick: () => setCreateOpen(false), disabled: busy, children: '取消' }),
          ] }),
        ] }) : null,

        jsx('div', { className: 'pe-list', children: state.presets.map((preset) => jsxs('div', { className: `pe-card${openId === preset.id ? ' open' : ''}`, children: [
          jsxs('div', { className: 'pe-card-head', onClick: () => openEditor(preset), children: [
            jsx('span', { className: 'pe-name', children: preset.name }),
            jsx('span', { className: 'pe-id', children: preset.id }),
            preset.order === null ? null : jsx('span', { className: 'pe-order', children: `order ${preset.order}` }),
            jsx('span', { className: 'pe-spacer' }),
            preset.source === 'bundle' ? jsx('span', { className: 'pe-badge', children: 'bundle 定义 · 编辑将生成覆盖行' }) : jsx('span', { className: 'pe-badge on', children: 'profile patch' }),
            preset.broken ? jsx('span', { className: 'pe-badge warn', children: '激活失败' }) : null,
          ] }),
          openId === preset.id && draft ? jsxs('div', { className: 'pe-card-body', children: [
            jsxs('div', { className: 'pe-row2', children: [
              jsx('label', { className: 'pe-field', children: [
                jsx('span', { className: 'pe-label', children: '显示名称' }),
                jsx('input', { type: 'text', value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }) }),
              ] }),
              jsx('label', { className: 'pe-field', children: [
                jsx('span', { className: 'pe-label', children: 'order' }),
                jsx('input', { type: 'number', value: draft.order, onChange: (e) => setDraft({ ...draft, order: e.target.value }) }),
              ] }),
            ] }),
            jsx('label', { className: 'pe-field', children: [
              jsx('span', { className: 'pe-label', children: '描述' }),
              jsx('input', { type: 'text', value: draft.description, onChange: (e) => setDraft({ ...draft, description: e.target.value }) }),
            ] }),
            jsx('label', { className: 'pe-field prefix', children: [
              jsx('span', { className: 'pe-label', children: 'system prompt — persona prefix（模型实际看到的开头指令）' }),
              jsx('textarea', { value: draft.personaPrefix, spellCheck: false, onChange: (e) => setDraft({ ...draft, personaPrefix: e.target.value }) }),
            ] }),
            jsx('label', { className: 'pe-field suffix', children: [
              jsx('span', { className: 'pe-label', children: 'persona suffix' }),
              jsx('textarea', { value: draft.personaSuffix, spellCheck: false, onChange: (e) => setDraft({ ...draft, personaSuffix: e.target.value }) }),
            ] }),
            compaction ? jsxs('div', { className: 'pe-compaction', children: [
              jsx('div', { className: 'pe-compaction-title', children: '上下文压缩（本 preset 生效参数）' }),
              jsx('div', { className: 'pe-hint', children: '每步把保留轮数以外的历史折成交接 brief；提醒在第 remindOnRound 轮的首步注入给模型。' }),
              jsxs('div', { className: 'pe-row2', children: [
                jsx('label', { className: 'pe-field', children: [
                  jsx('span', { className: 'pe-label', children: '保留轮数 keepRounds' }),
                  jsx('input', { type: 'number', min: 0, value: compaction.keepRounds, onChange: (e) => setCompaction({ ...compaction, keepRounds: e.target.value }) }),
                ] }),
                jsx('label', { className: 'pe-field', children: [
                  jsx('span', { className: 'pe-label', children: '提醒轮次 remindOnRound（空=跟随保留轮数）' }),
                  jsx('input', { type: 'number', min: 0, value: compaction.remindOnRound === null ? '' : compaction.remindOnRound, onChange: (e) => setCompaction({ ...compaction, remindOnRound: e.target.value }) }),
                ] }),
                jsx('label', { className: 'pe-field', children: [
                  jsx('span', { className: 'pe-label', children: '最小折叠 alwaysMinSpanTokens' }),
                  jsx('input', { type: 'number', min: 0, value: compaction.alwaysMinSpanTokens, onChange: (e) => setCompaction({ ...compaction, alwaysMinSpanTokens: e.target.value }) }),
                ] }),
                jsx('label', { className: 'pe-field', children: [
                  jsx('span', { className: 'pe-label', children: 'token 尾 retainTokens（keepRounds=0 时）' }),
                  jsx('input', { type: 'number', min: 0, value: compaction.retainTokens, onChange: (e) => setCompaction({ ...compaction, retainTokens: e.target.value }) }),
                ] }),
              ] }),
              jsx('label', { className: 'pe-field', children: [
                jsx('span', { className: 'pe-label', children: '提醒文案 reminder（留空=引擎默认）' }),
                jsx('input', { type: 'text', value: compaction.reminder === null ? '' : compaction.reminder, onChange: (e) => setCompaction({ ...compaction, reminder: e.target.value }) }),
              ] }),
              jsx('label', { className: 'pe-check', children: [
                jsx('input', { type: 'checkbox', checked: compaction.alwaysCompact === true, onChange: (e) => setCompaction({ ...compaction, alwaysCompact: e.target.checked }) }),
                jsx('span', { children: 'alwaysCompact：每次模型调用前都折叠（单动作压缩）' }),
              ] }),
              jsx('label', { className: 'pe-check', children: [
                jsx('input', { type: 'checkbox', checked: compaction.summaryOnly === true, onChange: (e) => setCompaction({ ...compaction, summaryOnly: e.target.checked }) }),
                jsx('span', { children: 'summaryOnly：单轮记忆 — 每轮只带交接小结做事，轮末把「上轮小结+本轮」重写成下一轮小结（此时 keepRounds 不生效）' }),
              ] }),
            ] }) : null,
            jsxs('div', { className: 'pe-card-actions', children: [
              jsx('button', { type: 'button', className: 'pe-btn primary', onClick: save, disabled: busy, children: busy ? '保存中…' : '保存到 preset' }),
              jsx('button', { type: 'button', className: 'pe-btn', onClick: () => { setOpenId(null); setDraft(null); }, disabled: busy, children: '收起' }),
            ] }),
          ] }) : null,
        ] })) }),
      ] });
    }

    function PresetIcon({ size, active }) {
      return jsx('span', {
        className: 'pe-icon',
        style: { width: size, height: size },
        children: jsxs('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: active ? 2.1 : 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
          children: [
            jsx('rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }),
            jsx('path', { d: 'M8 8h8' }),
            jsx('path', { d: 'M8 12h8' }),
            jsx('path', { d: 'M8 16h5' }),
          ],
        }),
      });
    }

    function apply(ctx) {
      ensureStyles();
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
      }, () => jsx(PresetPanel, {})), 'preset-studio: main panel');
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 8,
        label: '预设',
        locale: NS,
      }, (props) => jsx(PresetIcon, { size: (props && props.size) || 18, active: !!(props && props.active) })), 'preset-studio: sidebar entry');
    }

    return { inject: ['slots'], apply };
  },
});
