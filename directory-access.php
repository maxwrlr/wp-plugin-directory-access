<?php
/**
 * Plugin Name: Directory Access
 * Description: Access and modify the directory structure inside /wp-content/uploads/.
 * Version: 1.0.0
 * Author: maxwrlr
 */

require 'includes/lib.php';
require 'includes/api.php';

add_action( 'plugins_loaded', 'wpdir_add_hooks' );
