import { attributeChanged, checkAttributeChanged, connectNode, disconnectNode } from './custom-element-registry';
import { dataset } from './dataset';
import { matches, selectAll, selectOne } from './selector';
import { MockAttr, MockAttributeMap, createAttributeProxy } from './attribute';
import { MockClassList } from './class-list';
import { MockCSSStyleDeclaration, createCSSStyleDeclaration } from './css-style-declaration';
import { MockEvent, addEventListener, dispatchEvent, removeEventListener, resetEventListeners } from './event';
import { NODE_NAMES, NODE_TYPES } from './constants';
import { NON_ESCAPABLE_CONTENT, SerializeNodeToHtmlOptions, serializeNodeToHtml } from './serialize-node';
import { parseFragmentUtil } from './parse-util';

export class MockNode {
    private _nodeValue: string;
    nodeName: string;
    nodeType: number;
    ownerDocument: any;
    parentNode: MockNode;
    childNodes: MockNode[];

    constructor(ownerDocument: any, nodeType: number, nodeName: string, nodeValue: string) {
        this.ownerDocument = ownerDocument;
        this.nodeType = nodeType;
        this.nodeName = nodeName;
        this._nodeValue = nodeValue;
        this.parentNode = null;
        this.childNodes = [];
    }

    appendChild(newNode: MockNode) {
        if (newNode.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT_NODE) {
            const nodes = newNode.childNodes.slice();
            for (const child of nodes) {
                this.appendChild(child);
            }
        } else {
            newNode.remove();
            newNode.parentNode = this;
            this.childNodes.push(newNode);
            connectNode(this.ownerDocument, newNode);
        }
        return newNode;
    }

    append(...items: (MockNode | string)[]) {
        items.forEach(item => {
            const isNode = typeof item === 'object' && item !== null && 'nodeType' in item;
            this.appendChild(isNode ? item : this.ownerDocument.createTextNode(String(item)));
        });
    }

    prepend(...items: (MockNode | string)[]) {
        const firstChild = this.firstChild;
        items.forEach(item => {
            const isNode = typeof item === 'object' && item !== null && 'nodeType' in item;
            this.insertBefore(isNode ? item : this.ownerDocument.createTextNode(String(item)), firstChild);
        });
    }

    cloneNode(deep?: boolean): MockNode {
        throw new Error(`invalid node type to clone: ${this.nodeType}, deep: ${deep}`);
    }

    compareDocumentPosition(_other: MockNode) {
        // unimplemented
        // https://developer.mozilla.org/en-US/docs/Web/API/Node/compareDocumentPosition
        return -1;
    }

    get firstChild() {
        return this.childNodes[0] || null;
    }

    insertBefore(newNode: MockNode, referenceNode: MockNode) {
        if (newNode.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT_NODE) {
            for (let i = 0, ii = newNode.childNodes.length; i < ii; i++) {
                insertBefore(this, newNode.childNodes[i], referenceNode);
            }
        } else {
            insertBefore(this, newNode, referenceNode);
        }

        return newNode;
    }

    get isConnected() {
        let node = this as any;
        while (node != null) {
            if (node.nodeType === NODE_TYPES.DOCUMENT_NODE) {
                return true;
            }

            node = node.parentNode;

            if (node != null && node.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT_NODE) {
                node = node.host;
            }
        }

        return false;
    }

    isSameNode(node: any) {
        return this === node;
    }

    get lastChild() {
        return this.childNodes[this.childNodes.length - 1] || null;
    }

    get nextSibling() {
        if (this.parentNode != null) {
            const index = this.parentNode.childNodes.indexOf(this) + 1;
            return this.parentNode.childNodes[index] || null;
        }
        return null;
    }

    get nodeValue() {
        return this._nodeValue;
    }
    set nodeValue(value: string) {
        this._nodeValue = value;
    }

    get parentElement() {
        return ((this.parentNode as any) as MockElement) || null;
    }
    set parentElement(value: any) {
        this.parentNode = value;
    }

    get previousSibling() {
        if (this.parentNode != null) {
            const index = this.parentNode.childNodes.indexOf(this) - 1;
            return this.parentNode.childNodes[index] || null;
        }
        return null;
    }

    contains(otherNode: MockNode) {
        return this.childNodes.includes(otherNode);
    }

    removeChild(childNode: MockNode) {
        const index = this.childNodes.indexOf(childNode);
        if (index > -1) {
            this.childNodes.splice(index, 1);

            if (this.nodeType === NODE_TYPES.ELEMENT_NODE) {
                const wasConnected = this.isConnected;

                childNode.parentNode = null;

                if (wasConnected === true) {
                    disconnectNode(childNode);
                }
            } else {
                childNode.parentNode = null;
            }
        } else {
            throw new Error(`node not found within childNodes during removeChild`);
        }
        return childNode;
    }

    remove() {
        if (this.parentNode != null) {
            this.parentNode.removeChild(this);
        }
    }

    replaceChild(newChild: MockNode, oldChild: MockNode) {
        if (oldChild.parentNode === this) {
            this.insertBefore(newChild, oldChild);
            oldChild.remove();
            return newChild;
        }
        return null;
    }

    get textContent() {
        return this._nodeValue;
    }
    set textContent(value: string) {
        this._nodeValue = String(value);
    }

    static ELEMENT_NODE = 1;
    static TEXT_NODE = 3;
    static PROCESSING_INSTRUCTION_NODE = 7;
    static COMMENT_NODE = 8;
    static DOCUMENT_NODE = 9;
    static DOCUMENT_TYPE_NODE = 10;
    static DOCUMENT_FRAGMENT_NODE = 11;
}

export class MockNodeList {
    childNodes: MockNode[];
    length: number;
    ownerDocument: any;

    constructor(ownerDocument: any, childNodes: MockNode[], length: number) {
        this.ownerDocument = ownerDocument;
        this.childNodes = childNodes;
        this.length = length;
    }
}

export class MockElement extends MockNode {
    namespaceURI: string;
    __attributeMap: MockAttributeMap;
    __shadowRoot: ShadowRoot;
    __style: MockCSSStyleDeclaration;

    constructor(ownerDocument: any, nodeName: string) {
        super(ownerDocument, NODE_TYPES.ELEMENT_NODE, typeof nodeName === 'string' ? nodeName : null, null);
        this.namespaceURI = null;
    }

    addEventListener(type: string, handler: (ev?: any) => void) {
        addEventListener(this, type, handler);
    }

    attachShadow(_opts: ShadowRootInit) {
        const shadowRoot = this.ownerDocument.createDocumentFragment();
        this.shadowRoot = shadowRoot;
        return shadowRoot;
    }

    get shadowRoot() {
        return this.__shadowRoot || null;
    }
    set shadowRoot(shadowRoot: any) {
        if (shadowRoot != null) {
            shadowRoot.host = this;
            this.__shadowRoot = shadowRoot;
        } else {
            delete this.__shadowRoot;
        }
    }

    get attributes() {
        if (this.__attributeMap == null) {
            this.__attributeMap = createAttributeProxy(false);
        }
        return this.__attributeMap;
    }

    set attributes(attrs: MockAttributeMap) {
        this.__attributeMap = attrs;
    }

    get children() {
        return this.childNodes.filter(n => n.nodeType === NODE_TYPES.ELEMENT_NODE) as MockElement[];
    }

    get childElementCount() {
        return this.childNodes.filter(n => n.nodeType === NODE_TYPES.ELEMENT_NODE).length;
    }

    get className() {
        return this.getAttributeNS(null, 'class') || '';
    }
    set className(value: string) {
        this.setAttributeNS(null, 'class', value);
    }

    get classList() {
        return new MockClassList(this as any);
    }

    click() {
        dispatchEvent(this, new MockEvent('click', { bubbles: true, cancelable: true, composed: true }));
    }

    cloneNode(_deep?: boolean): MockElement {
        // implemented on MockElement.prototype from within element.ts
        return null;
    }

    closest(selector: string) {
        let elm = this;
        while (elm != null) {
            if (elm.matches(selector)) {
                return elm;
            }
            elm = elm.parentNode as any;
        }
        return null;
    }

    get dataset() {
        return dataset(this);
    }

    get dir() {
        return this.getAttributeNS(null, 'dir') || '';
    }
    set dir(value: string) {
        this.setAttributeNS(null, 'dir', value);
    }

    dispatchEvent(ev: MockEvent) {
        return dispatchEvent(this, ev);
    }

    get firstElementChild() {
        return this.children[0] || null;
    }

    getAttribute(attrName: string) {
        if (attrName === 'style') {
            if (this.__style != null && this.__style.length > 0) {
                return this.style.cssText;
            }
            return null;
        }
        const attr = this.attributes.getNamedItem(attrName);
        if (attr != null) {
            return attr.value;
        }
        return null;
    }

    getAttributeNS(namespaceURI: string, attrName: string) {
        const attr = this.attributes.getNamedItemNS(namespaceURI, attrName);
        if (attr != null) {
            return attr.value;
        }
        return null;
    }

    getAttributNames() {
        return this.attributes.getAttributeNames();
    }
    getBoundingClientRect() {
        return { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 };
    }

    getRootNode(opts?: { composed?: boolean;[key: string]: any }) {
        const isComposed = opts != null && opts.composed === true;

        let node: Node = this as any;

        while (node.parentNode != null) {
            node = node.parentNode;

            if (isComposed === true && node.parentNode == null && (node as any).host != null) {
                node = (node as any).host;
            }
        }

        return node;
    }

    get draggable() {
        return this.getAttributeNS(null, 'draggable') === 'true';
    }
    set draggable(value: boolean) {
        this.setAttributeNS(null, 'draggable', value);
    }

    hasChildNodes() {
        return this.childNodes.length > 0;
    }

    get id() {
        return this.getAttributeNS(null, 'id') || '';
    }
    set id(value: string) {
        this.setAttributeNS(null, 'id', value);
    }

    get innerHTML() {
        if (this.childNodes.length === 0) {
            return '';
        }
        return serializeNodeToHtml(this as any, {
            newLines: false,
            indentSpaces: 0,
        });
    }

    set innerHTML(html: string) {
        if (NON_ESCAPABLE_CONTENT.has(this.nodeName) === true) {
            setTextContent(this, html);
        } else {
            for (let i = this.childNodes.length - 1; i >= 0; i--) {
                this.removeChild(this.childNodes[i]);
            }

            if (typeof html === 'string') {
                const frag = parseFragmentUtil(this.ownerDocument, html);
                while (frag.childNodes.length > 0) {
                    this.appendChild(frag.childNodes[0]);
                }
            }
        }
    }

    get innerText() {
        const text: string[] = [];
        getTextContent(this.childNodes, text);
        return text.join('');
    }

    set innerText(value: string) {
        setTextContent(this, value);
    }

    insertAdjacentElement(position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend', elm: MockHTMLElement) {
        if (position === 'beforebegin') {
            insertBefore(this.parentNode, elm, this);
        } else if (position === 'afterbegin') {
            this.prepend(elm);
        } else if (position === 'beforeend') {
            this.appendChild(elm);
        } else if (position === 'afterend') {
            insertBefore(this.parentNode, elm, this.nextSibling);
        }
        return elm;
    }

    insertAdjacentHTML(position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend', html: string) {
        const frag = parseFragmentUtil(this.ownerDocument, html);
        if (position === 'beforebegin') {
            while (frag.childNodes.length > 0) {
                insertBefore(this.parentNode, frag.childNodes[0], this);
            }
        } else if (position === 'afterbegin') {
            while (frag.childNodes.length > 0) {
                this.prepend(frag.childNodes[frag.childNodes.length - 1]);
            }
        } else if (position === 'beforeend') {
            while (frag.childNodes.length > 0) {
                this.appendChild(frag.childNodes[0]);
            }
        } else if (position === 'afterend') {
            while (frag.childNodes.length > 0) {
                insertBefore(this.parentNode, frag.childNodes[frag.childNodes.length - 1], this.nextSibling);
            }
        }
    }

    insertAdjacentText(position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend', text: string) {
        const elm = this.ownerDocument.createTextNode(text);
        if (position === 'beforebegin') {
            insertBefore(this.parentNode, elm, this);
        } else if (position === 'afterbegin') {
            this.prepend(elm);
        } else if (position === 'beforeend') {
            this.appendChild(elm);
        } else if (position === 'afterend') {
            insertBefore(this.parentNode, elm, this.nextSibling);
        }
    }

    hasAttribute(attrName: string) {
        if (attrName === 'style') {
            return this.__style != null && this.__style.length > 0;
        }
        return this.getAttribute(attrName) !== null;
    }

    hasAttributeNS(namespaceURI: string, name: string) {
        return this.getAttributeNS(namespaceURI, name) !== null;
    }

    get hidden() {
        return this.hasAttributeNS(null, 'hidden');
    }
    set hidden(isHidden: boolean) {
        if (isHidden === true) {
            this.setAttributeNS(null, 'hidden', '');
        } else {
            this.removeAttributeNS(null, 'hidden');
        }
    }

    get lang() {
        return this.getAttributeNS(null, 'lang') || '';
    }
    set lang(value: string) {
        this.setAttributeNS(null, 'lang', value);
    }

    get lastElementChild() {
        const children = this.children;
        return children[children.length - 1] || null;
    }

    matches(selector: string) {
        return matches(selector, this);
    }

    get nextElementSibling() {
        const parentElement = this.parentElement;
        if (
            parentElement != null &&
            (parentElement.nodeType === NODE_TYPES.ELEMENT_NODE || parentElement.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT_NODE || parentElement.nodeType === NODE_TYPES.DOCUMENT_NODE)
        ) {
            const children = parentElement.children;
            const index = children.indexOf(this) + 1;
            return parentElement.children[index] || null;
        }
        return null;
    }

    get outerHTML() {
        return serializeNodeToHtml(this as any, {
            newLines: false,
            outerHtml: true,
            indentSpaces: 0,
        });
    }

    get previousElementSibling() {
        const parentElement = this.parentElement;
        if (
            parentElement != null &&
            (parentElement.nodeType === NODE_TYPES.ELEMENT_NODE || parentElement.nodeType === NODE_TYPES.DOCUMENT_FRAGMENT_NODE || parentElement.nodeType === NODE_TYPES.DOCUMENT_NODE)
        ) {
            const children = parentElement.children;
            const index = children.indexOf(this) - 1;
            return parentElement.children[index] || null;
        }
        return null;
    }

    getElementsByClassName(classNames: string) {
        const classes = classNames
            .trim()
            .split(' ')
            .filter(c => c.length > 0);
        const results: MockElement[] = [];
        getElementsByClassName(this, classes, results);
        return results;
    }

    getElementsByTagName(tagName: string) {
        const results: MockElement[] = [];
        getElementsByTagName(this, tagName.toLowerCase(), results);
        return results;
    }

    querySelector(selector: string) {
        return selectOne(selector, this);
    }

    querySelectorAll(selector: string) {
        return selectAll(selector, this);
    }

    removeAttribute(attrName: string) {
        if (attrName === 'style') {
            delete this.__style;
        } else {
            const attr = this.attributes.getNamedItem(attrName);
            if (attr != null) {
                this.attributes.removeNamedItemNS(attr);
                if (checkAttributeChanged(this) === true) {
                    attributeChanged(this, attrName, attr.value, null);
                }
            }
        }
    }

    removeAttributeNS(namespaceURI: string, attrName: string) {
        const attr = this.attributes.getNamedItemNS(namespaceURI, attrName);
        if (attr != null) {
            this.attributes.removeNamedItemNS(attr);
            if (checkAttributeChanged(this) === true) {
                attributeChanged(this, attrName, attr.value, null);
            }
        }
    }

    removeEventListener(type: string, handler: any) {
        removeEventListener(this, type, handler);
    }

    setAttribute(attrName: string, value: any) {
        if (attrName === 'style') {
            this.style = value;
        } else {
            const attributes = this.attributes;
            let attr = attributes.getNamedItem(attrName);
            const checkAttrChanged = checkAttributeChanged(this);

            if (attr != null) {
                if (checkAttrChanged === true) {
                    const oldValue = attr.value;
                    attr.value = value;

                    if (oldValue !== attr.value) {
                        attributeChanged(this, attr.name, oldValue, attr.value);
                    }
                } else {
                    attr.value = value;
                }
            } else {
                if (attributes.caseInsensitive) {
                    attrName = attrName.toLowerCase();
                }
                attr = new MockAttr(attrName, value);
                attributes.__items.push(attr);

                if (checkAttrChanged === true) {
                    attributeChanged(this, attrName, null, attr.value);
                }
            }
        }
    }

    setAttributeNS(namespaceURI: string, attrName: string, value: any) {
        const attributes = this.attributes;
        let attr = attributes.getNamedItemNS(namespaceURI, attrName);
        const checkAttrChanged = checkAttributeChanged(this);

        if (attr != null) {
            if (checkAttrChanged === true) {
                const oldValue = attr.value;
                attr.value = value;

                if (oldValue !== attr.value) {
                    attributeChanged(this, attr.name, oldValue, attr.value);
                }
            } else {
                attr.value = value;
            }
        } else {
            attr = new MockAttr(attrName, value, namespaceURI);
            attributes.__items.push(attr);

            if (checkAttrChanged === true) {
                attributeChanged(this, attrName, null, attr.value);
            }
        }
    }

    get style() {
        if (this.__style == null) {
            this.__style = createCSSStyleDeclaration();
        }
        return this.__style;
    }
    set style(val: any) {
        if (typeof val === 'string') {
            if (this.__style == null) {
                this.__style = createCSSStyleDeclaration();
            }
            this.__style.cssText = val;
        } else {
            this.__style = val;
        }
    }

    get tabIndex() {
        return parseInt(this.getAttributeNS(null, 'tabindex') || '-1', 10);
    }
    set tabIndex(value: number) {
        this.setAttributeNS(null, 'tabindex', value);
    }

    get tagName() {
        return this.nodeName;
    }
    set tagName(value: string) {
        this.nodeName = value;
    }

    get textContent() {
        const text: string[] = [];
        getTextContent(this.childNodes, text);
        return text.join('');
    }
    set textContent(value: string) {
        setTextContent(this, value);
    }

    get title() {
        return this.getAttributeNS(null, 'title') || '';
    }
    set title(value: string) {
        this.setAttributeNS(null, 'title', value);
    }

    onanimationstart() {
        /**/
    }
    onanimationend() {
        /**/
    }
    onanimationiteration() {
        /**/
    }
    onabort() {
        /**/
    }
    onauxclick() {
        /**/
    }
    onbeforecopy() {
        /**/
    }
    onbeforecut() {
        /**/
    }
    onbeforepaste() {
        /**/
    }
    onblur() {
        /**/
    }
    oncancel() {
        /**/
    }
    oncanplay() {
        /**/
    }
    oncanplaythrough() {
        /**/
    }
    onchange() {
        /**/
    }
    onclick() {
        /**/
    }
    onclose() {
        /**/
    }
    oncontextmenu() {
        /**/
    }
    oncopy() {
        /**/
    }
    oncuechange() {
        /**/
    }
    oncut() {
        /**/
    }
    ondblclick() {
        /**/
    }
    ondrag() {
        /**/
    }
    ondragend() {
        /**/
    }
    ondragenter() {
        /**/
    }
    ondragleave() {
        /**/
    }
    ondragover() {
        /**/
    }
    ondragstart() {
        /**/
    }
    ondrop() {
        /**/
    }
    ondurationchange() {
        /**/
    }
    onemptied() {
        /**/
    }
    onended() {
        /**/
    }
    onerror() {
        /**/
    }
    onfocus() {
        /**/
    }
    onfocusin() {
        /**/
    }
    onfocusout() {
        /**/
    }
    onformdata() {
        /**/
    }
    onfullscreenchange() {
        /**/
    }
    onfullscreenerror() {
        /**/
    }
    ongotpointercapture() {
        /**/
    }
    oninput() {
        /**/
    }
    oninvalid() {
        /**/
    }
    onkeydown() {
        /**/
    }
    onkeypress() {
        /**/
    }
    onkeyup() {
        /**/
    }
    onload() {
        /**/
    }
    onloadeddata() {
        /**/
    }
    onloadedmetadata() {
        /**/
    }
    onloadstart() {
        /**/
    }
    onlostpointercapture() {
        /**/
    }
    onmousedown() {
        /**/
    }
    onmouseenter() {
        /**/
    }
    onmouseleave() {
        /**/
    }
    onmousemove() {
        /**/
    }
    onmouseout() {
        /**/
    }
    onmouseover() {
        /**/
    }
    onmouseup() {
        /**/
    }
    onmousewheel() {
        /**/
    }
    onpaste() {
        /**/
    }
    onpause() {
        /**/
    }
    onplay() {
        /**/
    }
    onplaying() {
        /**/
    }
    onpointercancel() {
        /**/
    }
    onpointerdown() {
        /**/
    }
    onpointerenter() {
        /**/
    }
    onpointerleave() {
        /**/
    }
    onpointermove() {
        /**/
    }
    onpointerout() {
        /**/
    }
    onpointerover() {
        /**/
    }
    onpointerup() {
        /**/
    }
    onprogress() {
        /**/
    }
    onratechange() {
        /**/
    }
    onreset() {
        /**/
    }
    onresize() {
        /**/
    }
    onscroll() {
        /**/
    }
    onsearch() {
        /**/
    }
    onseeked() {
        /**/
    }
    onseeking() {
        /**/
    }
    onselect() {
        /**/
    }
    onselectstart() {
        /**/
    }
    onstalled() {
        /**/
    }
    onsubmit() {
        /**/
    }
    onsuspend() {
        /**/
    }
    ontimeupdate() {
        /**/
    }
    ontoggle() {
        /**/
    }
    onvolumechange() {
        /**/
    }
    onwaiting() {
        /**/
    }
    onwebkitfullscreenchange() {
        /**/
    }
    onwebkitfullscreenerror() {
        /**/
    }
    onwheel() {
        /**/
    }

    toString(opts?: SerializeNodeToHtmlOptions) {
        return serializeNodeToHtml(this as any, opts);
    }
}

function getElementsByClassName(elm: MockElement, classNames: string[], foundElms: MockElement[]) {
    const children = elm.children;
    for (let i = 0, ii = children.length; i < ii; i++) {
        const childElm = children[i];
        for (let j = 0, jj = classNames.length; j < jj; j++) {
            if (childElm.classList.contains(classNames[j])) {
                foundElms.push(childElm);
            }
        }
        getElementsByClassName(childElm, classNames, foundElms);
    }
}

function getElementsByTagName(elm: MockElement, tagName: string, foundElms: MockElement[]) {
    const children = elm.children;
    for (let i = 0, ii = children.length; i < ii; i++) {
        const childElm = children[i];
        if (tagName === '*' || childElm.nodeName.toLowerCase() === tagName) {
            foundElms.push(childElm);
        }
        getElementsByTagName(childElm, tagName, foundElms);
    }
}

export function resetElement(elm: MockElement) {
    resetEventListeners(elm);
    delete elm.__attributeMap;
    delete elm.__shadowRoot;
    delete elm.__style;
}

function insertBefore(parentNode: MockNode, newNode: MockNode, referenceNode: MockNode) {
    if (newNode !== referenceNode) {
        newNode.remove();
        newNode.parentNode = parentNode;
        newNode.ownerDocument = parentNode.ownerDocument;

        if (referenceNode != null) {
            const index = parentNode.childNodes.indexOf(referenceNode);
            if (index > -1) {
                parentNode.childNodes.splice(index, 0, newNode);
            } else {
                throw new Error(`referenceNode not found in parentNode.childNodes`);
            }
        } else {
            parentNode.childNodes.push(newNode);
        }

        connectNode(parentNode.ownerDocument, newNode);
    }

    return newNode;
}

export class MockHTMLElement extends MockElement {
    namespaceURI = 'http://www.w3.org/1999/xhtml';

    constructor(ownerDocument: any, nodeName: string) {
        super(ownerDocument, typeof nodeName === 'string' ? nodeName.toUpperCase() : null);
    }

    get tagName() {
        return this.nodeName;
    }
    set tagName(value: string) {
        this.nodeName = value;
    }

    get attributes() {
        if (this.__attributeMap == null) {
            this.__attributeMap = createAttributeProxy(true);
        }
        return this.__attributeMap;
    }
    set attributes(attrs: MockAttributeMap) {
        this.__attributeMap = attrs;
    }
}

export class MockTextNode extends MockNode {
    constructor(ownerDocument: any, text: string) {
        super(ownerDocument, NODE_TYPES.TEXT_NODE, NODE_NAMES.TEXT_NODE, text);
    }

    cloneNode(_deep?: boolean) {
        return new MockTextNode(null, this.nodeValue);
    }

    get textContent() {
        return this.nodeValue;
    }
    set textContent(text) {
        this.nodeValue = text;
    }

    get data() {
        return this.nodeValue;
    }
    set data(text) {
        this.nodeValue = text;
    }

    get wholeText() {
        if (this.parentNode != null) {
            const text: string[] = [];
            for (let i = 0, ii = this.parentNode.childNodes.length; i < ii; i++) {
                const childNode = this.parentNode.childNodes[i];
                if (childNode.nodeType === NODE_TYPES.TEXT_NODE) {
                    text.push(childNode.nodeValue);
                }
            }
            return text.join('');
        }

        return this.nodeValue;
    }
}

function getTextContent(childNodes: MockNode[], text: string[]) {
    for (let i = 0, ii = childNodes.length; i < ii; i++) {
        const childNode = childNodes[i];
        if (childNode.nodeType === NODE_TYPES.TEXT_NODE) {
            text.push(childNode.nodeValue);
        } else if (childNode.nodeType === NODE_TYPES.ELEMENT_NODE) {
            getTextContent(childNode.childNodes, text);
        }
    }
}

function setTextContent(elm: MockElement, text: string) {
    for (let i = elm.childNodes.length - 1; i >= 0; i--) {
        elm.removeChild(elm.childNodes[i]);
    }
    const textNode = new MockTextNode(elm.ownerDocument, text);
    elm.appendChild(textNode);
}
