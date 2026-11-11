import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { getAISettings, saveAISettings, testAISettings } from '../../services/api';
import { clearGrammarAnalysisCache } from '../GrammarAnalysis/grammarCache';
import './AISettings.css';

interface DialogProps {
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

function AISettingsDialog({ onClose, returnFocusRef }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const id = useId();
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com');
  const [model, setModel] = useState('deepseek-flash');
  const [busy, setBusy] = useState<'saving' | 'testing' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const returnFocusElement = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || []);
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const focusIn = (event: FocusEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) closeRef.current?.focus();
    };
    document.addEventListener('keydown', keyDown);
    document.addEventListener('focusin', focusIn);
    return () => {
      requestRef.current?.abort();
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('focusin', focusIn);
      returnFocusElement?.focus();
    };
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const settings = await getAISettings(controller.signal);
        if (controller.signal.aborted) return;
        setConfigured(settings.api_key_configured);
        setBaseUrl(settings.base_url);
        setModel(settings.model);
        setLoaded(true);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '无法读取 AI 设置');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [loadAttempt]);

  const submit = async (action: 'saving' | 'testing') => {
    if (!formRef.current?.reportValidity()) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const input = { base_url: baseUrl.trim(), model: model.trim(), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) };
    setBusy(action);
    setError('');
    setSuccess('');
    try {
      if (action === 'saving') {
        clearGrammarAnalysisCache();
        const settings = await saveAISettings(input, controller.signal);
        if (controller.signal.aborted) return;
        setApiKey('');
        setConfigured(settings.api_key_configured);
        setBaseUrl(settings.base_url);
        setModel(settings.model);
        clearGrammarAnalysisCache();
        window.dispatchEvent(new Event('sublearn:ai-settings-saved'));
        setSuccess('设置已保存，语法解析将使用新配置。');
      } else {
        const result = await testAISettings(input, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.message || '连接失败，请检查配置');
        setSuccess(result.message || '连接成功。当前测试配置尚未保存。');
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '操作失败，请稍后重试');
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  };
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); void submit('saving'); };

  return createPortal(
    <div className="ai-settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="ai-settings-panel">
        <div className="ai-settings-heading">
          <div><div className="ai-settings-eyebrow">SUBlearn · AI</div><h2 id={`${id}-title`}>AI 设置</h2></div>
          <button ref={closeRef} type="button" aria-label="关闭 AI 设置" className="ai-settings-close" onClick={onClose}>×</button>
        </div>
        <p className="ai-settings-intro">配置你的 DeepSeek，解析台词中的句子结构与语法。</p>
        {loading && <p className="ai-settings-status" role="status">正在读取设置…</p>}
        {!loading && !loaded && <button type="button" className="ai-settings-secondary" onClick={() => { setError(''); setLoading(true); setLoadAttempt(value => value + 1); }}>重新读取设置</button>}
        <form ref={formRef} onSubmit={handleSubmit}>
          <fieldset disabled={loading || !loaded || busy !== null} className="ai-settings-fields">
            <div className="ai-settings-field"><label htmlFor={`${id}-provider`}>服务商</label><input id={`${id}-provider`} value="DeepSeek" readOnly className="ai-settings-readonly" /></div>
            <div className="ai-settings-field">
              <label htmlFor={`${id}-key`}>API Key <span aria-hidden="true" className={configured ? 'ai-settings-configured' : 'ai-settings-unconfigured'}>{configured ? '已配置' : '未配置'}</span></label>
              <input id={`${id}-key`} aria-label="API Key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={configured ? '已配置，留空保留' : '输入你的 DeepSeek API Key'} autoComplete="new-password" spellCheck={false} required={!configured} />
              <p className="ai-settings-hint">密钥保存在服务器，不会回显；留空保留已保存的密钥。</p>
            </div>
            <div className="ai-settings-field"><label htmlFor={`${id}-base`}>API 地址</label><input id={`${id}-base`} type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} required spellCheck={false} placeholder="https://api.deepseek.com" /></div>
            <div className="ai-settings-field">
              <label htmlFor={`${id}-model`}>模型</label><input id={`${id}-model`} list={`${id}-models`} value={model} onChange={event => setModel(event.target.value)} required spellCheck={false} placeholder="deepseek-flash" />
              <datalist id={`${id}-models`}><option value="deepseek-flash" /><option value="deepseek-v4-pro" /></datalist>
              <p className="ai-settings-hint">可选 deepseek-flash、deepseek-v4-pro，或填写自定义模型名称。</p>
            </div>
          </fieldset>
          {error && <p role="alert" className="ai-settings-error">{error}</p>}
          {success && <p role="status" className="ai-settings-success">{success}</p>}
          <div className="ai-settings-actions">
            <button type="button" className="ai-settings-secondary" disabled={loading || !loaded || busy !== null} onClick={() => void submit('testing')}>{busy === 'testing' ? '正在测试…' : '测试连接'}</button>
            <button type="submit" className="ai-settings-primary" disabled={loading || !loaded || busy !== null}>{busy === 'saving' ? '正在保存…' : '保存设置'}</button>
          </div>
          <p className="ai-settings-footnote">测试连接只验证当前填写的配置，不会自动保存。</p>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export default function AISettingsButton() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const openSettings = () => setOpen(true);
    window.addEventListener('sublearn:open-ai-settings', openSettings);
    return () => window.removeEventListener('sublearn:open-ai-settings', openSettings);
  }, []);
  return <><button ref={buttonRef} type="button" className="ai-settings-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">AI 设置</button>{open && <AISettingsDialog onClose={close} returnFocusRef={buttonRef} />}</>;
}
