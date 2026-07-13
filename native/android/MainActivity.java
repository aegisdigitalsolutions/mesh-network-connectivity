package com.meshlink.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.meshlink.app.bond.MeshBondingPlugin;

/**
 * Capacitor generates a default MainActivity.java that does NOT register
 * app-local plugins. The CI workflow overwrites the generated file with this
 * one so the MeshBonding plugin is registered and window.MeshBonding becomes
 * available to the web layer. Without this, the plugin silently never loads
 * and the app stays in simulation mode.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MeshBondingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
