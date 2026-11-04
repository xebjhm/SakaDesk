import { describe, it, expect, beforeEach } from 'vitest';
import { tabbables } from './tabbables';

let frame: HTMLElement;
beforeEach(() => {
    document.body.innerHTML = '';
    frame = document.createElement('div');
    document.body.appendChild(frame);
});

const names = () => tabbables(frame).map((el) => el.getAttribute('data-n'));

describe('tabbables', () => {
    it('keeps native controls, links, editable content, media with controls, summary and iframes in DOM order', () => {
        frame.innerHTML = `
            <a href="#" data-n="a"></a><a data-n="no-href"></a>
            <button data-n="b"></button><input data-n="i"><select data-n="s"></select><textarea data-n="t"></textarea>
            <div contenteditable="" data-n="ce"></div><div contenteditable="false" data-n="ce-off"></div>
            <video controls data-n="v"></video><video data-n="v-bare"></video><audio controls data-n="au"></audio>
            <details><summary data-n="sum"></summary><summary data-n="sum2"></summary></details>
            <iframe data-n="if"></iframe><div tabindex="0" data-n="div0"></div><div data-n="plain"></div>`;
        expect(names()).toEqual(['a', 'b', 'i', 's', 't', 'ce', 'v', 'au', 'sum', 'if', 'div0']);
    });

    it('drops tabindex=-1 on any element, disabled, inert, hidden and hidden-input elements', () => {
        frame.innerHTML = `
            <button data-n="ok"></button><button tabindex="-1" data-n="minus"></button><a href="#" tabindex="-1" data-n="a-minus"></a>
            <button disabled data-n="dis"></button><fieldset disabled><input data-n="fs"></fieldset>
            <div inert><button data-n="inert"></button></div><button hidden data-n="hidden-attr"></button>
            <div style="display:none"><button data-n="none-parent"></button></div><input type="file" style="display:none" data-n="file">
            <button style="visibility:hidden" data-n="invisible"></button><input type="hidden" data-n="type-hidden">`;
        expect(names()).toEqual(['ok']);
    });

    it('keeps only the checked radio of a named group, or the first when none is checked', () => {
        frame.innerHTML = `
            <input type="radio" name="speed" data-n="r1"><input type="radio" name="speed" checked data-n="r2"><input type="radio" name="speed" data-n="r3">
            <input type="radio" name="mode" data-n="m1"><input type="radio" name="mode" data-n="m2">
            <input type="radio" data-n="lone1"><input type="radio" data-n="lone2">`;
        expect(names()).toEqual(['r2', 'm1', 'lone1', 'lone2']);
    });

    it('puts positive tabindex first, in tabindex order, then the rest in DOM order', () => {
        frame.innerHTML = `<button data-n="x"></button><button tabindex="2" data-n="two"></button><button tabindex="1" data-n="one"></button><button data-n="y"></button>`;
        expect(names()).toEqual(['one', 'two', 'x', 'y']);
    });

    it('keeps DOM order: an input before a button, with a summary in the selector', () => {
        frame.innerHTML = `<input data-n="i"><button data-n="b"></button><details><summary data-n="sum"></summary></details><textarea data-n="t"></textarea>`;
        expect(names()).toEqual(['i', 'b', 'sum', 't']);
    });

    it('keeps DOM order: a radio group before a button', () => {
        frame.innerHTML = `<input type="radio" name="g" data-n="r1"><input type="radio" name="g" data-n="r2"><button data-n="b"></button><a href="#" data-n="a"></a>`;
        expect(names()).toEqual(['r1', 'b', 'a']);
    });

    it('keeps DOM order across nesting and mixed kinds', () => {
        frame.innerHTML = `<div><select data-n="s"></select><span><button data-n="b"></button></span></div><a href="#" data-n="a"></a><div tabindex="0" data-n="d"><input data-n="i"></div>`;
        expect(names()).toEqual(['s', 'b', 'a', 'd', 'i']);
    });
});
