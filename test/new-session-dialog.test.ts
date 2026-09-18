import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNewSessionInput, openNewSessionDialog, type NewSessionDialog } from '../src/tui/new-session-dialog.js';
import { setFocus, toggleWorktree } from '../src/tui/new-form.js';
import type { NewSessionDialogContext } from '../src/tui/dialog.js';

test('Enter creates from text fields and activates non-text controls',()=>{
 const created:unknown[]=[];
 const ctx={actions:{newFormContext:()=>({cwd:'/code/web'}),createSession:(input:unknown)=>created.push(input)},setMessage:()=>{},runAction:(fn:()=>unknown)=>fn()} as unknown as NewSessionDialogContext;
 let dialog=openNewSessionDialog(ctx);
 assert.equal(handleNewSessionInput(dialog,'\r',ctx),undefined);
 assert.equal(created.length,1);
 dialog=openNewSessionDialog(ctx);
 dialog={...dialog,optionsExpanded:true,form:setFocus(dialog.form,'group')};
 assert.equal(handleNewSessionInput(dialog,'\r',ctx),undefined);
 assert.equal(created.length,2);
 dialog=openNewSessionDialog(ctx);
 dialog={...dialog,optionsExpanded:true,form:setFocus(toggleWorktree(dialog.form),'branch')};
 dialog.form.fields.branch.value='feature/web';
 assert.equal(handleNewSessionInput(dialog,'\r',ctx),undefined);
 assert.equal(created.length,3);
 dialog=openNewSessionDialog(ctx);
 const moved=handleNewSessionInput({...dialog,actionFocus:'add'},'\r',ctx) as NewSessionDialog;
 assert.equal(moved.form.focus,'repo:1');
 assert.equal(created.length,3);
});
