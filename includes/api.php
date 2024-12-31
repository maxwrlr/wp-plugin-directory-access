<?php

function wpdir_add_hooks() {
	add_action( 'admin_enqueue_scripts', 'wpdir_enqueue_admin_scripts' );
	add_filter( 'restrict_manage_posts', 'wpdir_enqueue_post_filter' );
	
	add_filter( 'ajax_query_attachments_args', 'wpdir_ajaxQueryAttachmentsArgs', 20 );
	add_filter( 'posts_clauses', 'wpdir_postsClauses', 10, 2 );
	add_filter( 'upload_dir', 'wpdir_upload_dir' );
	
	add_action( 'wp_ajax_wpdir_sync', 'wpdir_ajax_sync' );
	add_action( 'wp_ajax_wpdir_mkdir', 'wpdir_ajax_mkdir' );
	add_action( 'wp_ajax_wpdir_rename', 'wpdir_ajax_rename' );
	add_action( 'wp_ajax_wpdir_move', 'wpdir_ajax_move' );
	add_action( 'wp_ajax_wpdir_move_attachments', 'wpdir_ajax_move_attachments' );
	add_action( 'wp_ajax_wpdir_delete', 'wpdir_ajax_delete' );
}

function wpdir_enqueue_admin_scripts() {
	wp_enqueue_script( 'jquery-ui-draggable' );
	wp_enqueue_script( 'jquery-ui-droppable' );
	
	$dist = plugin_dir_url( __DIR__ ) . 'dist/';
	wp_enqueue_style( 'wpdir', $dist . 'style-index.css' );
	wp_enqueue_script( 'wpdir', $dist . 'index.js' );
	wp_set_script_translations( 'wpdir', 'directory-access', plugin_dir_path( __DIR__ ) . 'locales/' );
	
	wp_localize_script( 'wpdir', 'fbv_data', array(
		'folders' => wpdir_scandir( '', true )
	) );
}

function wpdir_enqueue_post_filter() {
	$screen = get_current_screen();
	if ( $screen->id == 'upload' ) {
		$wpdir = isset( $_GET['wpdir'] ) ? sanitize_text_field( $_GET['wpdir'] ) : '';
		echo '<input type="hidden" name="wpdir" value="' . $wpdir . '">';
	}
}

function wpdir_upload_dir( $result ) {
	$wpdir = isset( $_REQUEST['wpdir'] ) ? $_REQUEST['wpdir'] : '';
	
	$subdir = '/' . ltrim( $wpdir, '/' );
	
	return array(
		'path'    => $result['basedir'] . $subdir,
		'url'     => $result['baseurl'] . $subdir,
		'subdir'  => $subdir,
		'basedir' => $result['basedir'],
		'baseurl' => $result['baseurl'],
		'error'   => false,
	);
}

function wpdir_ajaxQueryAttachmentsArgs( $query ) {
	if ( isset( $_REQUEST['query']['wpdir'] ) ) {
		$query['wpdir'] = $_REQUEST['query']['wpdir'];
	}
	
	return $query;
}

function wpdir_postsClauses( $clauses, $query ) {
	if ( $query->get( 'post_type' ) !== 'attachment' ) {
		return $clauses;
	}
	
	$wpdir = $_GET['wpdir'] ?? $query->get( 'wpdir' );
	if ( $wpdir ) {
		// make sure it ends with a slash
		$wpdir = ( $wpdir == '/' ? '' : $wpdir . '/' );
		
		global $wpdb;
		$clauses['where'] .=
			" AND ID in (select post_id from $wpdb->postmeta where" .
			" meta_value like '" . esc_sql( $wpdir ) . "%' AND" .
			" substring(meta_value, " . strlen( $wpdir ) . " + 1) not like '%/%')";
	}
	
	return $clauses;
}

function wpdir_ajax_sync() {
	$dirname = isset( $_POST['id'] ) ? $_POST['id'] : '/';
	wpdir_commit_contents( $dirname );
	wp_send_json_success();
}

function wpdir_ajax_mkdir() {
	$parent = isset( $_POST['parent'] ) ? $_POST['parent'] : '';
	$name   = isset( $_POST['name'] ) ? $_POST['name'] : '';
	if ( ! $name ) {
		wp_send_json_error( new WP_Error( 400 ) );
	}
	
	$new_id = wpdir_join( $parent, $name );
	$target = wpdir_resolve( $new_id );
	if ( mkdir( $target ) ) {
		wp_send_json_success( $new_id );
	} else {
		wp_send_json_error();
	}
}

function wpdir_ajax_move() {
	$id     = isset( $_POST['id'] ) ? $_POST['id'] : '';
	$parent = isset( $_POST['parent'] ) ? $_POST['parent'] : '';
	if ( ! $id || ! $parent ) {
		wp_send_json_error( new WP_Error( 400 ) );
	}
	
	$new_id = wpdir_join( $parent, basename( $id ) );
	if ( wpdir_move_directory( $id, $new_id ) ) {
		wp_send_json_success( $new_id );
	} else {
		wp_send_json_error();
	}
}

function wpdir_ajax_move_attachments() {
	$ids    = isset( $_POST['ids'] ) ? $_POST['ids'] : '';
	$parent = isset( $_POST['parent'] ) ? $_POST['parent'] : '';
	if ( ! $ids || ! $parent ) {
		wp_send_json_error( new WP_Error( 400 ) );
	}
	
	foreach ( $ids as $id ) {
		wpdir_move_attachment( $id, $parent );
	}
	
	wp_send_json_success();
}

function wpdir_ajax_rename() {
	$id   = isset( $_POST['id'] ) ? $_POST['id'] : '';
	$name = isset( $_POST['name'] ) ? $_POST['name'] : '';
	if ( ! $id || ! $name ) {
		wp_send_json_error( new WP_Error( 400 ) );
	}
	
	$new_id = wpdir_join( dirname( $id ), basename( $name ) );
	if ( wpdir_move_directory( $id, $new_id ) ) {
		wp_send_json_success( $new_id );
	} else {
		wp_send_json_error();
	}
}

function wpdir_ajax_delete() {
	$id = isset( $_POST['id'] ) ? $_POST['id'] : '';
	if ( ! $id ) {
		wp_send_json_error( new WP_Error( 400 ) );
	}
	
	if ( wpdir_delete( $id ) ) {
		wp_send_json_success();
	} else {
		wp_send_json_error( error_get_last() );
	}
}
