import {DirectoryNode, IDirectory, IDirectoryOptions} from './DirectoryNode';
import {EventEmitter} from './EventEmitter';
import {executeWordPressRequest} from "./api";
import {__, sprintf} from "@wordpress/i18n";

type TreeEvents = {
	select: (directory: DirectoryNode) => void;
	removed: (ids: number[]) => void;
	reload: () => void;
}

const STATIC: IDirectoryOptions = {
	openable: false,
	renameable: false,
	draggable: false
};

export class DirectoryTree extends EventEmitter<TreeEvents> {
	readonly el: JQuery;

	private _all = new DirectoryNode({id: null, text: __('All Media Items', 'directory-access')}, {...STATIC, droppable: false});
	private _root = new DirectoryNode({id: '/', text: __('Unassigned', 'directory-access')}, STATIC);
	private _selected = this._all;

	constructor() {
		super();

		this.el = jQuery(`
<div class="wrap wpdir-wrapper">
	<div>
	<h1 class="wp-heading-inline"></h1>
	<button class="page-title-action aria-button-if-js"></button>
	</div>
	<div class="wpdir-toolbar wp-filter">
		<button class="wpdir-button-rename button media-button select-mode-toggle-button"></button>
		<button class="wpdir-button-delete button media-button select-mode-toggle-button"></button>
		<button class="wpdir-button-sync button media-button dashicons dashicons-update"></button>
	</div>
	<div class="wpdir-body">
		<div class="wpdir-items">
			<div class="wpdir-folder">
				<input class="wpdir-folder-label" type="text">
				<i class="dashicons dashicons-search"></i>
			</div>
		</div>
		<div class="separator"></div>
	</div>
</div>
`);

		// Set translations and attach event listeners to toolbar buttons.
		this.el.find('.wp-heading-inline').text(__('Directories', 'directory-access'));
		this.el.find('.page-title-action')
			.text(__('New Directory', 'directory-access'))
			.on('click', () => this.mkdir(this._selected));
		this.el.find('.wpdir-button-rename')
			.text(__('Rename', 'directory-access'))
			.on('click', () => this._selected.setEditMode(true));
		this.el.find('.wpdir-button-delete')
			.text(__('Delete', 'directory-access'))
			.on('click', () => this.delete(this._selected));
		this.el.find('.wpdir-button-sync').on('click', () => this.reload());
		this.el.find('input')
			.attr('placeholder', __('Filter directories', 'directory-access') + '…')
			.on('input', event => this.filter(event.target.value));

		// Append folders to DOM.
		this._all.el.add(this._root.el)
			.addClass('wpdir-static')
			.prependTo(this.el.find('.wpdir-items'));
		this._root.containerEl.removeClass()
			.addClass('wpdir-items wpdir-tree')
			.appendTo(this.el.children().last());

		this._root.setOpen(true);
		this._all.setSelected(true);
		this.select(this._all);
	}

	protected _register(directory: DirectoryNode) {
		directory.on('select', () => this.select(directory));

		directory.on('rename', name => {
			const isNew = !directory.raw.id;
			executeWordPressRequest({
				action: isNew ? 'wpdir_mkdir' : 'wpdir_rename',
				[isNew ? 'parent' : 'id']: isNew ? this._root.findParentOf(directory).raw.id : directory.raw.id,
				name
			}).then(res => {
				if (res.success) {
					directory.setId(res.data);
					if (!isNew) {
						this._root.findParentOf(directory).sortChildren();
					}
				}
			});
		});

		directory.on('remove', () => {
			this._root.findParentOf(directory).removeChild(directory);
		})

		directory.on('drop-directory', d => this.move(d, directory));

		directory.on('drop-item', ids => {
			executeWordPressRequest({
				action: 'wpdir_move_attachments',
				parent: directory.raw.id,
				ids
			}).then(res => {
				if (res.success) {
					this.trigger('removed', ids);
				}
			});
		});
	}

	/**
	 * Sync media with file system.
	 */
	reload() {
		const sync = this.el.find('button.wpdir-button-sync');
		sync.prop('disabled', true);

		executeWordPressRequest({
			action: 'wpdir_sync',
			id: this._selected.raw.id
		}).then(() => {
			this.trigger('reload');
		}).catch(
			console.error
		).finally(() => {
			sync.prop('disabled', false);
		});
	}

	select(directory: DirectoryNode) {
		if (directory !== this._selected) {
			this._selected.setSelected(false);
			this._selected = directory;
			this.trigger('select', directory);
		}

		this.el.find('.wpdir-button-rename, .wpdir-button-delete')
			.prop('disabled', this._selected === this._root || this._selected === this._all);
	}

	getSelectedId() {
		return this._selected.raw.id;
	}

	mkdir(parent: DirectoryNode) {
		if (parent === this._all) {
			parent = this._root;
		}

		const directory = new DirectoryNode({id: null, text: __('New Directory', 'directory-access')}, STATIC);
		parent.appendChild(directory);
		directory.setEditMode(true);
		directory.el.get(0).scrollIntoView();

		this._register(directory);
	}

	move(directory: DirectoryNode, newParent: DirectoryNode) {
		// prevent cycles
		if (directory.findParentOf(newParent)) {
			return;
		}

		// prevent unnecessary (nothing changed) or invalid (name exists) updates
		const oldParent = this._root.findParentOf(directory);
		if (oldParent === newParent || newParent.children.some(d => d.raw.text === directory.raw.text)) {
			return;
		}

		executeWordPressRequest({
			action: 'wpdir_move',
			parent: newParent.raw.id,
			id: directory.raw.id
		}).then(res => {
			if (res.success) {
				directory.setId(res.data);
				oldParent.removeChild(directory);
				newParent.appendChild(directory);
				newParent.setOpen(true);
			}
		});
	}

	delete(directory: DirectoryNode) {
		if (confirm(sprintf(__('Really delete "%s"?', 'directory-access'), directory.raw.text))) {
			executeWordPressRequest({
				action: 'wpdir_delete',
				id: directory.raw.id
			}).then(res => {
				if (!res.success) {
					return;
				}

				const parent = this._root.findParentOf(directory);
				if (parent) {
					parent.removeChild(directory);
					parent.setSelected(true);
				}
			});
		}
	}

	setChildren(children: IDirectory[]) {
		this._root.setChildren(children);
		DirectoryNode.forAll([this._all, this._root], d => this._register(d));
	}

	filter(filter: string) {
		this._root.filter(filter);
	}

	mount() {
		jQuery('#wpbody')
			.prepend(`<div class="wpdir-vr-wrapper"><div class="wpdir-vr"></div></div>`)
			.prepend(this.el);
	}
}
