import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dashboardEnv } from "../src/app/dashboard.js";
import { readFile, readdir } from "node:fs/promises";

const fixture = `
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { buildRenderModel } from './dist/src/tui/render-model.js';
import { renderSessions, renderForm, truncate, renderCursorValue } from './dist/src/tui/layout.js';
import { buildDashboardCommands, selectWorkspaceCommands } from './dist/src/tui/dashboard-commands.js';
import { darkTheme, stripAnsi, styleToken, styleBgToken, effectiveDashboardTheme } from './dist/src/tui/theme.js';
import { SessionsController } from './dist/src/app/controller.js';
import { SessionsView } from './dist/src/tui/sessions-view.js';
import { ConversationReader, renderConversationPane, renderMarkdown } from './dist/src/tui/conversation.js';
import { createQuestionDialog, renderQuestionDialog } from './dist/src/tui/question-dialog.js';
import { glyphs, ascii, worktreeGlyph } from './dist/src/tui/glyphs.js';
const steps = [{id:'plan', short:'PL'}, {id:'execute',short:'EX'}, {id:'review',short:'RV'}];
const sessions = ['running','waiting','idle','error','stopped'].map((status,i) => ({
  id:'s'+i, title:'A long readable session title '.repeat(4), cwd:'/tmp/repo', group:'work',
  tmuxSession:'hub-'+i, status, createdAt:1, updatedAt:1,
  worktreePath:'/tmp/worktree', worktreeBranch:'feature',
  workflow:{version:1,source:'test',steps,activeIndex:1,updatedAt:1},
  ...(i === 1 ? {context:{version:1,updatedAt:1,attention:{kind:'ready',text:'Please review',requestId:'r1'}}} : {})
}));
sessions.push({...sessions[0],id:'child',kind:'subagent',parentId:'s0',agentName:'tester', taskPreview:'Verify behavior'});
const commands = buildDashboardCommands({sessions, selectedId:'s0',capabilities:{openSession:true,restart:true}});
const frames = [];
for (const width of [80,160]) for (const grouping of ['project','stage']) for (const height of [16,40]) {
 const frame = renderSessions(buildRenderModel({sessions,selectedId:'s0',width,height,grouping,now:1000,
   expandedProjectParentIds:new Set(['s0']),expandedBoardParentIds:new Set(['s0']),
   workspaceFullScreen:width===80 && height===40,
   workspaceCommands:selectWorkspaceCommands(sessions[0],commands,4), workspaceEvidenceVisible:true}),darkTheme);
 assert.equal(frame.lines.length,height);
 for (const line of frame.lines) assert.equal(visibleWidth(line),width,JSON.stringify(line));
 frames.push(...frame.lines);
}
frames.push(...renderForm({title:'Create session',fields:[{key:'name',label:'Name',value:'example',frame:'input'}],focus:'name',footer:'Enter Create'},80,darkTheme));
for (const width of [80,160]) {
  const view = new SessionsView(new SessionsController({version:1,sessions}),()=>{}, {
    terminalRows:()=>40, newFormContext:()=>({cwd:'/tmp/repo'}), createSession:()=>{}
  },darkTheme);
  for (const key of ['?', ':', 'n']) {
    view.render(width); view.handleInput(key);
    const lines = view.render(width);
    assert.ok(lines.every(line=>visibleWidth(line)<=width));
    frames.push(...lines); view.handleInput('\\x1b');
  }
  const reader = new ConversationReader();
  reader.accept({branchId:'branch',revision:'1',items:[{id:'m1',role:'assistant',text:'# Hello\\n\\nA message.'}]});
  frames.push(...renderConversationPane({width,height:12,title:'CONVERSATION',transcript:reader.render(width,6,darkTheme),
    transcriptHeight:6,status:'Fleet focused',workingAt:1000,actions:[{id:'open',label:'Open in Pi'}],focusedAction:'open'},darkTheme).lines);
  const question = createQuestionDialog({managedId:'s0',piSessionId:'pi-s0',instanceId:'i'},'Choose',
    {toolCallId:'call',params:{questions:[{header:'Choice',question:'Which option?',multiSelect:true,options:[{label:'First',description:'A choice'}]}]}});
  question.selected.add(0);
  frames.push(...renderQuestionDialog(question,width,10,darkTheme));
}
`;

function run(source: string, env: NodeJS.ProcessEnv): string {
  return execFileSync(process.execPath, ["--input-type=module", "-e", fixture + source], {
    cwd: process.cwd(), env: { ...process.env, NO_COLOR: "", PI_AGENT_HUB_GLYPHS: "", ...env }, encoding: "utf8",
  });
}

test("NO_COLOR removes theme colors and keeps a reverse selected marker", () => {
  run(`
    assert.ok(frames.every(line => !/\\x1b\\[(?:[349][0-7]|[34]8[;:])/.test(line)));
    assert.ok(frames.some(line => line.includes('\\x1b[7m▌\\x1b[27m')));
    assert.equal(styleToken(darkTheme,'accent','hello'),'hello');
    assert.equal(styleBgToken(darkTheme,'selectedBg','hello'),'hello');
    const theme = await effectiveDashboardTheme({options:[],diagnostics:[]},{syncPi:true},'dark',{NO_COLOR:'1',PI_CODING_AGENT_DIR:'/nonexistent'});
    assert.deepEqual(theme.theme,darkTheme);
  `, { NO_COLOR: "1" });
});

test("empty NO_COLOR and default glyph mode retain color and Unicode", () => {
  run(`assert.ok(frames.some(line => line.includes('\\x1b[38;'))); assert.ok(frames.some(line => line.includes('╭')));`, { NO_COLOR: "", PI_AGENT_HUB_GLYPHS: "unknown" });
});

test("ASCII fleet, dense rows, board, workspace and form chrome fit exact widths", () => {
  run(`
    for (const line of frames) assert.match(stripAnsi(line),/^[\\x20-\\x7e]*$/);
    assert.equal(stripAnsi(truncate('abcdefghij',6)),'abc...');
    for (const width of [2,3,4,6]) {
      assert.ok(visibleWidth(renderCursorValue('a long path',10,width,'start')) <= width);
    }
    assert.equal(truncate('user 雪 text',20),'user 雪 text');
    for (const marker of ['⎇','⎇…','⎇!','⎇✓']) assert.match(worktreeGlyph(marker),/^[\\x20-\\x7e]+$/);
    for (const glyph of Object.values(ascii)) assert.match(glyph,/^[\\x20-\\x7e]+$/);
    const controller = new SessionsController({version:1,sessions:[{...sessions[0],title:'User 雪 → title',group:'Group ✓'}]});
    const view = new SessionsView(controller,()=>{},{terminalRows:()=>40},darkTheme);
    assert.ok(view.render(160).map(stripAnsi).join('\\n').includes('User 雪 → title'));
    const reader = new ConversationReader();
    reader.accept({branchId:'b',revision:'1',items:[{id:'m',role:'user',text:'User 雪 → text'}]});
    assert.ok(reader.render(80,10,darkTheme).map(stripAnsi).join('\\n').includes('User 雪 → text'));
    const markdown = renderMarkdown('> Quoted text\\n\\n| Name | Value |\\n| --- | --- |\\n| One | Two |',80,darkTheme).map(stripAnsi).join('\\n');
    assert.ok(markdown.includes('│ Quoted text'));
    assert.ok(markdown.includes('┌') && markdown.includes('└'));
  `, { PI_AGENT_HUB_GLYPHS: "ascii" });
});

test("dashboard recreation forwards glyph and no-color preferences", () => {
  assert.deepEqual(dashboardEnv({ PI_AGENT_HUB_GLYPHS: "ascii", NO_COLOR: "1" }), { PI_AGENT_HUB_GLYPHS: "ascii", NO_COLOR: "1" });
});

test("dashboard glyph literals stay in the glyph module", async () => {
  const root = "src/tui";
  for (const name of await readdir(root)) {
    if (!name.endsWith(".ts") || name === "glyphs.ts") continue;
    assert.doesNotMatch(await readFile(`${root}/${name}`, "utf8"), /[^\x00-\x7f]/, name);
  }
});
