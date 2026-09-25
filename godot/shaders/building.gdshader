// Procedural facades. UV = (metres along perimeter, metres above street).
// COLOR.rgb = facade colour (sRGB), COLOR.a = style: 0 punched windows, 0.5 glass curtain wall, 1 plain.
shader_type spatial;

global uniform float night;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void fragment() {
	vec3 base = pow(COLOR.rgb, vec3(2.2));
	float style = COLOR.a;
	float glass = step(0.25, style) * (1.0 - step(0.75, style));
	float plain = step(0.75, style);
	float seed = dot(COLOR.rgb, vec3(12.9, 78.2, 37.7));

	float floor_h = mix(3.6, 4.0, glass);
	float bay = mix(2.7, 1.5, glass);
	vec2 cell = vec2(UV.x / bay, UV.y / floor_h);
	vec2 id = floor(cell);
	vec2 f = fract(cell);

	float punched = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.85);
	float curtain = step(0.05, f.x) * step(0.08, f.y) * step(f.y, 0.95);
	float win = mix(punched, curtain, glass);

	// Fade the window grid to its average coverage once cells shrink below a few pixels (no shimmer).
	float cell_px = max(fwidth(cell.x), fwidth(cell.y));
	win = mix(win, mix(0.33, 0.8, glass), smoothstep(0.15, 0.45, cell_px));

	float street = 1.0 - step(4.4, UV.y);
	float shopfront = step(0.5, UV.y) * step(UV.y, 3.6) * step(0.06, fract(UV.x / 4.5));
	win = mix(win, shopfront, street) * (1.0 - plain) * step(0.0, UV.y);

	float h = hash(id + seed);
	vec3 facade = base * (0.92 + 0.08 * hash(vec2(floor(UV.x / 12.0), seed)));
	facade *= mix(1.0, 0.8, street * (1.0 - plain));
	facade = mix(facade, base * 0.72, glass);
	float cornice = step(fract(UV.y / floor_h), 0.05) * (1.0 - glass) * (1.0 - plain) * 0.12;
	facade *= 1.0 - cornice;

	vec3 sky = mix(vec3(0.05, 0.09, 0.14), vec3(0.32, 0.44, 0.56), f.y * 0.7 + h * 0.3);
	vec3 pane = mix(sky, base * 0.6, glass * 0.35);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	pane += fres * 0.25 * (1.0 - night);

	ALBEDO = mix(facade, pane, win);
	ROUGHNESS = mix(0.88, 0.12, win);
	METALLIC = win * 0.25;
	SPECULAR = mix(0.3, 0.7, win);

	float lit = step(0.68, hash(id * 1.37 + seed + 5.0));
	lit = mix(lit, 0.32, smoothstep(0.15, 0.45, cell_px));
	vec3 warm = mix(vec3(1.0, 0.7, 0.38), vec3(0.65, 0.8, 1.0), step(0.75, hash(id + seed + 11.0)));
	float shop = street * win;
	EMISSION = win * night * (lit * warm * (0.35 + 0.6 * h) + shop * vec3(0.7, 0.52, 0.34));
}
