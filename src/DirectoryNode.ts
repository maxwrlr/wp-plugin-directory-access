import {EventEmitter} from './EventEmitter';

type DirectoryCallback = (this: DirectoryNode, directory: DirectoryNode) => void;
type DirectoryEvents = {
	select: DirectoryCallback;
	open: DirectoryCallback;
	rename: (this: DirectoryNode, name: string, directory: DirectoryNode) => void;
	'drop-directory': (this: DirectoryNode, target: DirectoryNode, directory: DirectoryNode) => void;
	'drop-item': (this: DirectoryNode, itemIds: number[], directory: DirectoryNode) => void;
}

// used for Drag'n'Drop
let draggedFolder = null as DirectoryNode | null;
// used for detecting double click
let lastClick = <MouseEvent | null>null;

export interface IDirectory {
	id: string;
	text: string;
	children?: IDirectory[];
}

export interface IDirectoryFeatures {
	openable?: boolean;
	selectable?: boolean;
	renameable?: boolean;
	draggable?: boolean;
	droppable?: boolean;
}

export class DirectoryNode extends EventEmitter<DirectoryEvents> {
	readonly raw: IDirectory;
	readonly el: JQuery;
	// required for root node support (usage without this.el)
	readonly containerEl: JQuery;
	children: DirectoryNode[] = [];

	private _features: IDirectoryFeatures;
	private _open = false;

	private _filter = '';
	private _filteredChildren = <DirectoryNode[]>[];

	constructor(directory: IDirectory, features: IDirectoryFeatures = {}) {
		super();

		this.raw = directory;
		this.el = jQuery(`
<div class="wpdir-folder">
	<i class="dashicons"></i>
	<span class="wpdir-folder-label"></span>
	<div class="wpdir-folder-children"></div>
</div>`);
		this.containerEl = this.el.children().last();

		this._features = features;

		this.setName(directory.text);
		this.setChildren(directory.children || []);
		this.setOpen(this._open);

		this._attachListeners(features);
	}

	_attachListeners(features: IDirectoryFeatures) {
		const c = this.el.children();

		if (features.openable !== false) {
			c.get(0).addEventListener('click', () => this.setOpen(!this.isOpen()));
		}

		if (features.selectable !== false) {
			c.get(1).addEventListener('click', () => this.setSelected(true));
		}

		if (features.renameable !== false) {
			c.get(1).addEventListener('click', event => {
				if (!lastClick
					|| event.timeStamp - lastClick.timeStamp > 500
					|| lastClick.clientX !== event.clientX || lastClick.clientY !== event.clientY) {
					lastClick = event;
					return;
				}

				this.setEditMode(true);
				lastClick = event;
			});
		}

		if (features.draggable !== false) {
			c.eq(1).draggable({
				helper: () => this.el.clone().children(':not(i):not(span)').remove().end(),
				appendTo: 'body',
				cursorAt: {left: 20, top: 20},
				refreshPositions: true,

				start: () => {
					draggedFolder = this;
					DirectoryNode.forAll(this, f => f.el.addClass('ui-droppable-off'));
				},
				stop: () => {
					draggedFolder = null;
					DirectoryNode.forAll(this, f => f.el.removeClass('ui-droppable-off'));
				}
			});
		}

		if (features.droppable !== false) {
			const k = 'data-droppable-inside';
			const changed = delta => this.el.parents('.wpdir-folder')
				.each((_, e) => e.setAttribute(k, Math.max(0, (parseInt(e.getAttribute(k)) || 0) + delta).toString()));

			this.el.droppable({
				tolerance: 'pointer',
				accept: (jq) => !this.el.hasClass('ui-droppable-off')
					&& jq.is('.wpdir-folder-label, li.attachment, tr[id^="post-"]'),

				over: () => changed(1),
				out: () => changed(-1),
				deactivate: () => this.el.removeAttr(k),

				drop: ({originalEvent: {target}}, session) => {
					if (!jQuery(target).closest('.wpdir-folder:not(.ui-droppable-off)').is(this.el)) {
						return;
					}

					if (draggedFolder) {
						this.trigger('drop-directory', draggedFolder);
					} else {
						const ids = session.helper.data('ids');
						this.trigger('drop-item', ids);
					}
				}
			});
		}
	}

	static forAll(tree: DirectoryNode | DirectoryNode[], callback: DirectoryCallback) {
		if (!Array.isArray(tree)) {
			callback.call(tree, tree);
			tree = tree.children;
		}

		for (const folder of tree) {
			DirectoryNode.forAll(folder, callback);
		}
	}

	/**
	 * @param id - The new id without a trailing slash.
	 */
	setId(id: string) {
		const oldId = this.raw.id;
		this.raw.id = id;

		for (const child of this.children) {
			child.setId(id + child.raw.id.substring(oldId.length));
		}
	}

	setName(name: string) {
		this.el.children('span').text(this.raw.text = name);
	}

	setEditMode(edit: true);
	setEditMode(edit: false, commit?: boolean);
	setEditMode(edit: boolean, commit = false) {
		this.el.toggleClass('is-editing', edit);

		let input = this.el.children('input');
		if (edit) {
			// don't show UI twice
			if (input.length) {
				return;
			}

			input = jQuery(`<input class="wpdir-folder-label" type="text" placeholder="Ordnername eingeben...">`);

			input.on('blur', () => this.setEditMode(false, true));
			input.on('keydown', event => {
				if (event.which === 13) {
					this.setEditMode(false, true);
				} else if (event.which === 27) {
					this.setEditMode(false);
				}
			});

			input.val(this.raw.text);
			input.prependTo(this.el);
			input.get(0).select();
		} else if (input.length) {
			// commit value
			if (commit) {
				const value = input.val() as string;
				this.setName(value);
				this.trigger('rename', value);
			}

			this.el.children('input, .wpdir-folder-actions').remove();
		}
	}

	isOpen() {
		return this._open;
	}

	setOpen(open: boolean) {
		// don't rerender, but allow update of closed state
		if (open && this._open) {
			return;
		}

		this._open = open;
		this._updateContainer();
	}

	/**
	 * Render children if this folder is open.
	 */
	private _updateContainer() {
		const isOpen = this._open || this._filter && this._filteredChildren.length;

		// don't toggle the icon if children don't exist
		const showOpen = isOpen && this._features.openable !== false;
		// show dynamic icon
		const icon = this.el.children().first();
		icon.toggleClass('dashicons-category', !showOpen);
		icon.toggleClass('dashicons-open-folder', showOpen);

		const container = this.containerEl.children().detach().end();
		if (isOpen) {
			const children = this._filter ? this._filteredChildren : this.children;
			container.append(...children.map(c => c.el));
			this.trigger('open');
		} else {
			// close recursively
			this.children.forEach(c => c.setOpen(false));
		}
	}

	setSelected(selected) {
		this.el.toggleClass('is-selected', selected);
		if (selected) {
			this.trigger('select');
			if (this._features.openable !== false) {
				this.setOpen(true);
			}
		}
	}

	findParentOf(folder: DirectoryNode): DirectoryNode | null {
		return this.children.includes(folder) ? this :
			this.children.reduce((r, f) => r || f.findParentOf(folder), null);
	}

	setChildren(children: IDirectory[]) {
		this.children = children.map(f => new DirectoryNode(f)).sort(comparator);
		this._updateContainer();
	}

	sortChildren() {
		this.children.sort(comparator);
		this._updateContainer();
	}

	appendChild(folder: DirectoryNode) {
		this.children.push(folder);
		this.children.sort(comparator);

		// append to DOM
		if (this.isOpen()) {
			const index = this.children.indexOf(folder);
			if (index + 1 < this.children.length) {
				this.children[index + 1].el.before(folder.el);
			} else {
				this.containerEl.append(folder.el);
			}
		}
	}

	removeChild(folder: DirectoryNode) {
		const index = this.children.indexOf(folder);
		if (index < 0) {
			return;
		}

		this.children.splice(index, 1);
		folder.el.detach();
	}

	filter(filter: string) {
		filter = filter.trim();

		this._filter = filter;
		this._filteredChildren = this.children.filter(child => {
			const showChild = child.filter(filter);
			return showChild || child.raw.text.includes(filter);
		});

		this._updateContainer();
		return this._filteredChildren?.length > 0;
	}
}

/**
 * Sort folders by also comparing numbers of different lengths by their numeric value.
 */
export function comparator(a: DirectoryNode, b: DirectoryNode) {
	if (a.raw.text === b.raw.text) {
		return 0;
	}

	let s1 = a.raw.text.toLowerCase();
	let s2 = b.raw.text.toLowerCase();
	while (s1.length) {
		let v1 = s1.match(/^[^0-9+]*/)![0];
		let v2 = s2.match(/^[^0-9+]*/)![0];
		if (v1 !== v2) {
			return s1 < s2 ? -1 : 1;
		} else {
			s1 = s1.substring(v1.length);
			s2 = s2.substring(v2.length);
		}

		const x1 = parseInt(v1 = s1.match(/^[0-9]*/)![0]);
		const x2 = parseInt(v2 = s2.match(/^[0-9]*/)![0]);
		if (isNaN(x1) || isNaN(x2)) {
			break;
		}

		if (x1 !== x2) {
			return x1 < x2 ? -1 : 1;
		} else {
			s1 = s1.substring(v1.length);
			s2 = s2.substring(v2.length);
		}
	}

	return s1 < s2 ? -1 : 1;
}
