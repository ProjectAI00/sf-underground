// Elevated road deck. UV.x = 0 (right edge) .. 1 (left edge), UV.y = metres along the road.
// COLOR.r = lanes / 8, COLOR.g = one-way flag, COLOR.b = forward lanes / 8.
shader_type spatial;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float line_mask(float x, float at, float half_w) {
	return 1.0 - step(half_w, abs(x - at));
}

void fragment() {
	float lanes = max(1.0, floor(COLOR.r * 8.0 + 0.5));
	float oneway = step(0.5, COLOR.g);
	float fwd = floor(COLOR.b * 8.0 + 0.5);
	float x = UV.x * lanes;
	float hw = 0.035;

	float dash = step(fract(UV.y / 9.0), 0.33);
	float white = 0.0;
	for (float k = 1.0; k < 8.0; k += 1.0) {
		if (k >= lanes) break;
		if (oneway < 0.5 && abs(k - fwd) < 0.1) continue;
		white = max(white, line_mask(x, k, hw) * dash);
	}
	white = max(white, line_mask(x, 0.12, hw) + line_mask(x, lanes - 0.12, hw));
	float yellow = (1.0 - oneway) * (line_mask(x, fwd - 0.07, hw) + line_mask(x, fwd + 0.07, hw));

	vec2 wp = UV * vec2(lanes * 3.5, 1.0);
	float grain = hash(floor(wp * 8.0)) * 0.06 + hash(floor(wp * 0.5)) * 0.05;
	vec3 asphalt = vec3(0.055, 0.058, 0.066) * (0.9 + grain * 2.0);
	vec3 col = mix(asphalt, vec3(0.8), clamp(white, 0.0, 1.0));
	col = mix(col, vec3(0.8, 0.5, 0.05), clamp(yellow, 0.0, 1.0));
	ALBEDO = col;
	ROUGHNESS = 0.85;
}
