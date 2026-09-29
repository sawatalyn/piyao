/**
 * 本站专属 CKEditor 5 插件：免费版没有"画圈/重点划线/解除标注/插入图片"这几枚按钮，
 * 按官方插件机制（模型属性 + 命令 + componentFactory 按钮）补齐。
 *
 * 两条硬约束：
 * 1. 颜色与形制只用预置 class，绝不写行内样式 —— 严格 CSP 与后端 sanitize-html 白名单同时成立。
 * 2. 插图必须携带 data-mid，服务端据此判定图片引用与回收（见 server/src/store/posts.js）。
 */
import { Command, Plugin, ButtonView, Widget, toWidget } from 'ckeditor5';

export const ANNO_ATTR = 'yanAnno';
export const ANNO_COLORS = ['seal', 'gold', 'indigo', 'ink'];
export const ANNO_KINDS = ['circle', 'line'];
export const IMAGE_ELEMENT = 'yanImage';
export const PICK_IMAGE_EVENT = 'yanPickImage';

const KIND_TEXT = { circle: '画圈', line: '划线' };

const ICON_CIRCLE =
  '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
  '<ellipse cx="10" cy="10" rx="8.5" ry="6.1" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-dasharray="38 6" transform="rotate(-14 10 10)"/></svg>';

const ICON_LINE =
  '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
  '<path d="M4.5 6h11M6.5 9.4h7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  '<path d="M3.2 15.2h13.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

const ICON_CLEAR =
  '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
  '<ellipse cx="9.2" cy="10" rx="7.4" ry="5.4" fill="none" stroke="currentColor" stroke-width="1.4" ' +
  'transform="rotate(-14 9.2 10)"/><path d="M13.4 5.4l4.4 9.2" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round"/></svg>';

const ICON_IMAGE =
  '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
  '<rect x="2.4" y="4.4" width="15.2" height="11.2" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M3.6 13.6l3.7-4.1 2.6 2.9 2.2-2.4 4.1 3.9" fill="none" stroke="currentColor" stroke-width="1.3" ' +
  'stroke-linejoin="round"/><circle cx="7.1" cy="8.1" r="1.2" fill="currentColor"/></svg>';

function encode(kind, color) {
  return `${kind}-${color}`;
}

/** 模型属性值取 `circle-seal` 这类短串：字符串比对象更容易被引擎比较与合并。 */
function decode(value) {
  const [kind, color] = String(value || '').split('-');
  if (!ANNO_KINDS.includes(kind)) return { kind: 'circle', color: ANNO_COLORS[0] };
  return { kind, color: ANNO_COLORS.includes(color) ? color : ANNO_COLORS[0] };
}

/** 入库一律用无签名直链，读取期由服务端重新签名；把签名串留在正文会在 TTL 后集体 403。 */
const canonicalSrc = (src) => String(src || '').replace(/^([^?]+)\?.*$/, '$1');

function addToolbarButton(editor, name, { label, icon, modifier, commandName, toggleCommand }) {
  editor.ui.componentFactory.add(name, (locale) => {
    const button = new ButtonView(locale);
    button.set({ label, icon, tooltip: true });
    if (modifier) button.extendTemplate({ attributes: { class: modifier } });
    const command = commandName ? editor.commands.get(commandName) : null;
    if (command) button.bind('isEnabled').to(command);
    if (toggleCommand) {
      button.set({ isToggleable: true });
      button.bind('isOn').to(toggleCommand, 'active');
    }
    button.on('execute', () => editor.execute(name));
    return button;
  });
}

class YanAnnotationCommand extends Command {
  constructor(editor, kind, getColor) {
    super(editor);
    this.kind = kind;
    this.getColor = getColor;
    this.set('active', false);
  }

  refresh() {
    const model = this.editor.model;
    const selection = model.document.selection;
    const current = decode(selection.getAttribute(ANNO_ATTR));
    this.active = !selection.isCollapsed && current.kind === this.kind;
    this.isEnabled =
      !selection.isCollapsed && model.schema.checkAttributeInSelection(selection, ANNO_ATTR);
  }

  execute() {
    const model = this.editor.model;
    const selection = model.document.selection;
    const current = selection.getAttribute(ANNO_ATTR);
    const wanted = encode(this.kind, this.getColor());
    const removing = current === wanted;
    model.change((writer) => {
      const ranges = model.schema.getValidRanges(selection.getRanges(), ANNO_ATTR, {
        includeEmptyRanges: true,
      });
      for (const range of ranges) {
        if (removing) writer.removeAttribute(ANNO_ATTR, range);
        else writer.setAttribute(ANNO_ATTR, wanted, range);
      }
    });
  }
}

class YanAnnotationClearCommand extends Command {
  refresh() {
    this.isEnabled = Boolean(this.editor.model.document.selection.getAttribute(ANNO_ATTR));
  }

  execute() {
    const model = this.editor.model;
    model.change((writer) => {
      const selection = model.document.selection;
      if (selection.isCollapsed) {
        // 光标落在批注里也算：把整段同色批注的属性摘掉，等价于旧版"停在字上点解除"。
        const textNode = selection.getFirstPosition()?.textNode;
        if (textNode?.hasAttribute(ANNO_ATTR)) writer.removeAttribute(ANNO_ATTR, textNode);
        writer.removeSelectionAttribute(ANNO_ATTR);
        return;
      }
      const ranges = model.schema.getValidRanges(selection.getRanges(), ANNO_ATTR, {
        includeEmptyRanges: true,
      });
      for (const range of ranges) writer.removeAttribute(ANNO_ATTR, range);
    });
  }
}

/** 按钮只负责喊话，真正的上传与插图由 Vue 侧走本站既有的 /api/media 通道。 */
class YanImagePickerCommand extends Command {
  constructor(editor, canPick) {
    super(editor);
    this.canPick = canPick;
  }

  refresh() {
    const model = this.editor.model;
    const position = model.document.selection.getLastPosition();
    this.isEnabled = Boolean(position) && this.canPick() && model.canEditAt(position);
  }

  execute() {
    this.editor.fire(PICK_IMAGE_EVENT);
    return true;
  }
}

class YanAnnotationEditing extends Plugin {
  static get pluginName() {
    return 'YanAnnotationEditing';
  }

  init() {
    const editor = this.editor;
    editor.model.schema.extend('$text', { allowAttributes: ANNO_ATTR });
    editor.model.schema.setAttributeProperties(ANNO_ATTR, { isFormatting: true, copyOnEnter: false });

    editor.conversion.for('downcast').attributeToElement({
      model: ANNO_ATTR,
      view: (value, { writer }) => {
        const { kind, color } = decode(value);
        return writer.createAttributeElement(
          'span',
          { class: `anno anno-${kind} c-${color}` },
          { priority: 8 }
        );
      },
    });

    editor.conversion.for('upcast').elementToAttribute({
      view: { name: 'span', classes: 'anno' },
      model: {
        key: ANNO_ATTR,
        value: (viewElement) => {
          const kind = ANNO_KINDS.find((item) => viewElement.hasClass(`anno-${item}`));
          if (!kind) return null;
          const color = ANNO_COLORS.find((item) => viewElement.hasClass(`c-${item}`));
          return encode(kind, color || ANNO_COLORS[0]);
        },
      },
    });
  }
}

class YanImageEditing extends Plugin {
  static get pluginName() {
    return 'YanImageEditing';
  }

  static get requires() {
    return [Widget];
  }

  init() {
    const editor = this.editor;
    editor.model.schema.register(IMAGE_ELEMENT, {
      allowWhere: '$block',
      isObject: true,
      isBlock: true,
      allowAttributes: ['src', 'alt', 'mid'],
    });

    editor.conversion.for('dataDowncast').elementToElement({
      model: IMAGE_ELEMENT,
      view: (modelElement, { writer }) => figureView(writer, modelElement, false),
    });

    editor.conversion.for('editingDowncast').elementToElement({
      model: IMAGE_ELEMENT,
      view: (modelElement, { writer }) =>
        toWidget(figureView(writer, modelElement, true), writer, { label: '卷面插图' }),
    });

    editor.conversion.for('upcast').elementToElement({
      view: { name: 'figure', classes: 'rich-fig' },
      model: (viewElement, { writer, consumable }) => {
        const img = Array.from(viewElement.getChildren()).find((child) => child.is('element', 'img'));
        const src = img?.getAttribute('src');
        if (!src) return null;
        // 图注由 alt 派生，视图子节点整体吃掉，免得再走一遍默认转换。
        for (const child of Array.from(viewElement.getChildren())) consumable.consume(child, { name: true });
        return writer.createElement(IMAGE_ELEMENT, {
          src: String(src),
          alt: String(img.getAttribute('alt') || '辟谣档案插图'),
          mid: String(img.getAttribute('data-mid') || ''),
        });
      },
    });
  }

  /** Vue 上传成功后调用；块级对象交给你 insertObject，由它决定切段还是并列，别自己猜位置。 */
  insertImage({ src, alt, mid } = {}) {
    if (!src) return false;
    const model = this.editor.model;
    let inserted = false;
    model.change((writer) => {
      const element = writer.createElement(IMAGE_ELEMENT, {
        src: String(src),
        alt: String(alt || '辟谣档案插图'),
        mid: String(mid || ''),
      });
      try {
        inserted = Boolean(model.insertObject(element, null, null, { setSelection: 'after' }));
      } catch {
        inserted = false;
      }
    });
    return inserted;
  }
}

function figureView(writer, modelElement, editing) {
  const alt = modelElement.getAttribute('alt') || '辟谣档案插图';
  const src = editing
    ? modelElement.getAttribute('src')
    : canonicalSrc(modelElement.getAttribute('src'));
  const figure = writer.createContainerElement('figure', { class: 'rich-fig' });
  const img = writer.createEmptyElement('img', {
    class: 'rich-img',
    src: src || '',
    alt,
    'data-mid': modelElement.getAttribute('mid') || '',
    loading: 'lazy',
    decoding: 'async',
  });
  const caption = writer.createContainerElement('figcaption', { class: 'rich-cap' });
  writer.insert(writer.createPositionAt(caption, 0), writer.createText(alt));
  writer.insert(writer.createPositionAt(figure, 'end'), [img, caption]);
  return figure;
}

class YanMarkupUI extends Plugin {
  static get pluginName() {
    return 'YanMarkupUI';
  }

  static get requires() {
    return [YanAnnotationEditing, YanImageEditing];
  }

  init() {
    const editor = this.editor;
    const settings = editor.config.get('yanAnnotation') || {};
    const getColor = () => {
      const value = settings.getColor ? settings.getColor() : null;
      return ANNO_COLORS.includes(value) ? value : ANNO_COLORS[0];
    };

    for (const kind of ANNO_KINDS) {
      const commandName = `yanAnnotation${kind[0].toUpperCase()}${kind.slice(1)}`;
      const command = new YanAnnotationCommand(editor, kind, getColor);
      editor.commands.add(commandName, command);
      addToolbarButton(editor, commandName, {
        label: KIND_TEXT[kind],
        icon: kind === 'circle' ? ICON_CIRCLE : ICON_LINE,
        modifier: `tool-anno ck-yan-${kind}`,
        commandName,
        toggleCommand: command,
      });
    }

    const clearName = 'yanAnnotationClear';
    editor.commands.add(clearName, new YanAnnotationClearCommand(editor));
    addToolbarButton(editor, clearName, {
      label: '解除标注',
      icon: ICON_CLEAR,
      modifier: 'tool-anno-clear',
      commandName: clearName,
    });

    const pickerName = 'yanImagePicker';
    editor.commands.add(
      pickerName,
      new YanImagePickerCommand(editor, () => (settings.canPick ? settings.canPick() : true))
    );
    addToolbarButton(editor, pickerName, {
      label: '插入图片',
      icon: ICON_IMAGE,
      modifier: 'tool-image',
      commandName: pickerName,
    });
  }
}

/** 编辑器配置里只需列这一个类，其余部件由 requires 串起来。 */
export class YanMarkup extends Plugin {
  static get pluginName() {
    return 'YanMarkup';
  }

  static get requires() {
    return [YanMarkupUI];
  }
}
