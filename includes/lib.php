<?php

function wpdir_join( $path, ...$segments ) {
	foreach ( $segments as $segment ) {
		if ( $segment ) {
			$path = rtrim( $path, '/' );
			$path = $path ? $path . '/' . ltrim( $segment, '/' ) : $segment;
		}
	}
	
	return $path;
}

function wpdir_resolve( $filename ) {
	$basedir = wp_get_upload_dir()['basedir'];
	
	return wpdir_join( $basedir, $filename );
}

function wpdir_scandir( $dirname = '', $recurse = false ) {
	$basedir   = wpdir_resolve( $dirname );
	$filenames = scandir( $basedir );
	
	$result = array();
	foreach ( $filenames as $filename ) {
		// Don't show self and parent.
		if ( $filename[0] === '.' || ! is_dir( $basedir . '/' . $filename ) ) {
			continue;
		}
		
		// Map to API structure.
		$directory = (object) array(
			'id'   => wpdir_join( $dirname, $filename ),
			'text' => $filename,
		);
		
		if ( $recurse ) {
			$directory->children = wpdir_scandir( $directory->id, true );
		}
		
		$result[] = $directory;
	}
	
	return $result;
}


/**
 * Scan directory recursively and create post-entries for files that don't have one yet.
 */
function wpdir_commit_contents( $dirname ) {
	global $wpdb;
	
	$dir = wpdir_resolve( $dirname );
	$files = scandir( $dir );

	foreach ( $files as $filename ) {
		if ( str_starts_with( $filename, '.' ) ) {
			continue;
		}
		
		$uri      = '/' . wpdir_join( $dirname, $filename );
		$filepath = wpdir_resolve( $uri );
		
		if ( is_dir( $filepath ) ) {
			wpdir_commit_contents( wpdir_join( $dirname, $filename ) );
			continue;
		}
		
		$guid    = wp_get_upload_dir()['baseurl'] . $uri;
		$is_post = (int) $wpdb->get_var( "select count(*) from $wpdb->posts where guid = '" . sanitize_url( $wpdb->_escape( $guid ) ) . "'" );
		$is_meta = preg_match( "/-[0-9]+x[0-9]+\.[^.]+\$/", $filename ) && (int) $wpdb->get_var(
				"select count(*) from $wpdb->postmeta" .
				" where (meta_key = '_wp_attached_file' and meta_value = '" . $wpdb->_escape( substr( $uri, 1 ) ) . "')" .
				" or (meta_key = '_wp_attachment_metadata' and meta_value like '%\"" . ltrim( $dirname, '/' ) . "%\"$filename\";%')"
			);
		
		// do not insert attachments if they are already registered
		if ( $is_post || $is_meta ) {
			continue;
		}
		
		$ext  = pathinfo( $filename, PATHINFO_EXTENSION );
		$name = wp_basename( $filename, ".$ext" );
		
		$attachment = array(
			'guid'           => $guid,
			'post_title'     => sanitize_text_field( $name ),
			'post_mime_type' => wp_check_filetype_and_ext( $filepath, $filename )['type']
		);
		
		$result = wp_insert_attachment( $attachment, $filepath, true );#
		if ( $result instanceof WP_Error ) {
			wp_send_json_error( $result );
			exit();
		}
		
		// Generate media defaults like thumbnails / smaller versions.
		$meta = wp_generate_attachment_metadata( $result, $filepath );
		wp_update_attachment_metadata( $result, $meta );
		
		// Created files might have incorrect permissions in some setups.
		if ( $meta && isset( $meta['sizes'] ) ) {
			foreach ( $meta['sizes'] as $value ) {
				$helper_file = wpdir_join( dirname( $filepath ), $value['file'] );
				if ( file_exists( $helper_file ) ) {
					chmod( $helper_file, 0755 );
				}
			}
		}
	}
}

function wpdir_get_recursive_attachments( $id ) {
	global $wpdb;
	
	return $wpdb->get_results(
		"select ID, meta_value from $wpdb->posts inner join $wpdb->postmeta on ID = post_id" .
		" where post_type = 'attachment' and meta_key = '_wp_attached_file' and meta_value like '" . $wpdb->_escape( $id ) . "/%'"
	);
}

function wpdir_move_directory( $id, $new_id ): bool {
	if ( ! rename( wpdir_resolve( $id ), wpdir_resolve( $new_id ) ) ) {
		return false;
	}
	
	$attachments = wpdir_get_recursive_attachments( $id );
	foreach ( $attachments as $attachment ) {
		$filepath = wpdir_join( $new_id, substr( $attachment->meta_value, strlen( $id ) + 1 ) );
		wpdir_move_attachment( $attachment->ID, dirname( $filepath ), false );
	}
	
	return true;
}

function wpdir_move_attachment( $id, $to, $move_files = true ) {
	$meta = wp_get_attachment_metadata( $id );
	
	$filepath    = wpdir_resolve( $meta ? $meta['file'] : get_post_meta( $id, '_wp_attached_file' )[0] );
	$target_file = wpdir_join( $to, basename( $filepath ) );
	
	if ( $move_files ) {
		rename( $filepath, wpdir_resolve( $target_file ) );
		foreach ( $meta['sizes'] as $value ) {
			rename( wpdir_join( dirname( $filepath ), $value['file'] ), wpdir_resolve( wpdir_join( $to, $value['file'] ) ) );
		}
	}
	
	update_post_meta( $id, '_wp_attached_file', $target_file );
	if ( $meta ) {
		$meta['file'] = $target_file;
		wp_update_attachment_metadata( $id, $meta );
	}
}

function wpdir_rmrf( $file ) {
	if ( ! is_dir( $file ) ) {
		return unlink( $file );
	}
	
	foreach ( scandir( $file ) as $f ) {
		if ( $f != '.' && $f != '..' ) {
			wpdir_rmrf( $file . '/' . $f );
		}
	}
	
	return rmdir( $file );
}

function wpdir_delete( $id ) {
	$attachments = wpdir_get_recursive_attachments( $id );
	if ( count( $attachments ) > 0 ) {
		return false;
	}
	
	$filepath = wpdir_resolve( $id );
	
	return wpdir_rmrf( $filepath );
}
