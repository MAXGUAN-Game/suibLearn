import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLAYER_SETTINGS, newest, normalizePlayerSettings, normalizeProgress, readPlayerSettings, readWatchProgress, restorePosition, writePlayerSettings, writeWatchProgress } from '../src/utils/playerState.ts';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}
test('corrupt or disabled storage cannot stop opening a player', () => {
  const s = new MemoryStorage(); s.setItem('sublearn_player_settings_v1', '{broken');
  assert.deepEqual(readPlayerSettings(s), DEFAULT_PLAYER_SETTINGS);
  assert.deepEqual(readPlayerSettings(null), DEFAULT_PLAYER_SETTINGS);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(readPlayerSettings(blocked), DEFAULT_PLAYER_SETTINGS);
  assert.doesNotThrow(() => writePlayerSettings(DEFAULT_PLAYER_SETTINGS, blocked));
  assert.doesNotThrow(() => writeWatchProgress({video_id:'a',position:12,duration:100,updated_at:1},blocked));
});
test('settings retain supported speeds and booleans without accepting corrupt values', () => {
  const s = new MemoryStorage();
  const value = {speed:1.25,subtitle_mode:'off' as const,sentence_mode:true,updated_at:100};
  writePlayerSettings(value,s); assert.deepEqual(readPlayerSettings(s),value);
  assert.deepEqual(normalizePlayerSettings({speed:10,subtitle_mode:'ja',sentence_mode:'false',updated_at:Infinity}),DEFAULT_PLAYER_SETTINGS);
  assert.equal(normalizePlayerSettings({speed:.25,subtitle_mode:'original',sentence_mode:false}).speed,.25);
});
test('an episode keeps its own fractional progress and cannot inherit another video', () => {
  const s = new MemoryStorage();
  const a = {video_id:'a',position:123.45,duration:1500,updated_at:100};
  const b = {video_id:'b',position:5.3,duration:1600,updated_at:200};
  writeWatchProgress(a,s); writeWatchProgress(b,s);
  assert.deepEqual(readWatchProgress('a',s),a); assert.deepEqual(readWatchProgress('b',s),b);
  assert.equal(readWatchProgress('new',s).position,0);
  assert.equal(normalizeProgress(a,'b').position,0);
});
test('unloaded or invalid media does not erase an existing bookmark', () => {
  const s = new MemoryStorage();
  const a = {video_id:'a',position:123.45,duration:1500,updated_at:100};
  writeWatchProgress(a,s);
  for (const value of [{...a,position:NaN},{...a,position:-1},{...a,duration:0,position:0},{...a,position:2000}]) writeWatchProgress(value,s);
  assert.deepEqual(readWatchProgress('a',s),a);
});
test('metadata clamps resume to the actual file length without changing playback state', () => {
  assert.equal(restorePosition(123.45,1500),123.45);
  assert.equal(restorePosition(500,100),99.95);
  assert.equal(restorePosition(20,0),0);
  assert.equal(restorePosition(Infinity,100),0);
  assert.equal(restorePosition(-1,100),0);
});
test('newer server state wins across devices, newer offline state wins on reconnect', () => {
  const old = {...DEFAULT_PLAYER_SETTINGS,updated_at:10};
  const server = {...old,speed:1.5,updated_at:20};
  const offline = {...old,subtitle_mode:'off' as const,updated_at:30};
  assert.equal(newest(old,server),server); assert.equal(newest(offline,server),offline);
  assert.equal(newest(old,{...server,updated_at:10}).speed,1.5);
});
test('local bookmark storage stays bounded without dropping recently watched episodes', () => {
  const s = new MemoryStorage();
  for(let i=0;i<205;i++)writeWatchProgress({video_id:String(i),position:i,duration:1000,updated_at:i+1},s);
  assert.equal(Object.keys(JSON.parse(s.getItem('sublearn_watch_progress_v1')!)).length,200);
  assert.equal(readWatchProgress('0',s).position,0);
  assert.equal(readWatchProgress('204',s).position,204);
});
