import './style.scss';
import {DirectoryTree} from './DirectoryTree';

declare const wp;

// Directory structure, injected from php.
declare const fbv_data;

document.addEventListener('DOMContentLoaded', () => {
	const tree = new DirectoryTree();
	let collection;

	/**
	 * Enable drag and drop for media items.
	 */
	function registerDraggable(to: JQuery, helperCallback: (event) => number[]) {
		to.draggable({
			appendTo: 'body',
			cursorAt: {top: 45, left: 0},
			cursor: 'grabbing',
			helper(event) {
				const ids = helperCallback(event);
				const title = `${ids.length} Mediendateien`;
				const helper = jQuery(`<div class="wpdir-draghandle"></div>`).text(title);
				return helper.data('ids', ids);
			}
		});
	}

	// Hijack the media browser ...
	if (wp.media) {
		// ... when view mode is `grid`.
		const Browser = wp.media.view.AttachmentsBrowser;
		wp.media.view.AttachmentsBrowser = Browser.extend({
			initialize() {
				Browser.prototype.initialize.apply(this, arguments);

				collection = this.collection;
				collection.props.set({wpdir: ''});
				tree.on('select', f => this.collection.props.set({wpdir: f.raw.id}));
			},

			createToolbar() {
				Browser.prototype.createToolbar.apply(this, arguments);

				const isModal = this.controller.options.modal;
				if (isModal) {
					setTimeout(() => {
						const views = this.views.parent.views;
						const menu = views.get('.media-frame-menu');
						const view = new wp.media.View({el: '<div id="wpdir-helper">'});
						menu[0].views.add(view);

						const panelBody = tree.el.find('.wpdir-body')
						jQuery('#wpdir-helper')
							.closest('.hide-menu').removeClass('hide-menu').end()
							.replaceWith(panelBody);
					}, 50);
				} else {
					tree.mount();
				}
			}
		});

		const Library = wp.media.view.Attachment.Library;
		wp.media.view.Attachment.Library = Library.extend({
			initialize() {
				Library.prototype.initialize.apply(this, arguments);

				registerDraggable(this.$el, event => {
					const attachments = this.$el.closest('.attachments').find('.selected:not(.selection,:hidden)');
					if (attachments.length) {
						return attachments.map((_, t) => t.dataset.id).toArray();
					} else {
						return [event.currentTarget.dataset.id];
					}
				});
			}
		});
	} else {
		// ... when view mode is `list`.
		tree.mount();
		tree.on('select', directory => {
			jQuery('#posts-filter').find('input[name="wpdir"]').val(directory.raw.id).end().submit();
		});

		const e = jQuery('.wp-admin.upload-php #wpbody-content .wp-list-table tbody tr:not(.no-items)');
		registerDraggable(e, event => {
			const attachments = e.find('input[name=\'media[]\']:input:checked') as JQuery<HTMLInputElement>;
			if (attachments.length) {
				return attachments.map((_, t) => parseInt(t.value)).toArray();
			} else {
				return [parseInt(event.currentTarget.getAttribute('id').substring(5))];
			}
		});
	}

	if (wp.Uploader) {
		jQuery.extend(wp.Uploader.prototype, {
			init() {
				this.uploader.bind('BeforeUpload', item => {
					const id = tree.getSelectedId();
					if (id != null) {
						item.settings.multipart_params.wpdir = id;
					}
				});

				if (collection) {
					this.uploader.bind('UploadComplete', () => {
						collection._requery();
					});
				}
			}
		});
	}

	tree.setChildren(fbv_data.folders);
});
