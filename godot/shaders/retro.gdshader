// Full-screen pixelation + ordered-dither posterize for the retro look.
shader_type canvas_item;

uniform sampler2D screen : hint_screen_texture, filter_nearest;
uniform float pixel_size = 3.0;
uniform float levels = 20.0;

const mat4 BAYER = mat4(
	vec4(0.0, 8.0, 2.0, 10.0),
	vec4(12.0, 4.0, 14.0, 6.0),
	vec4(3.0, 11.0, 1.0, 9.0),
	vec4(15.0, 7.0, 13.0, 5.0));

void fragment() {
	vec2 px = SCREEN_PIXEL_SIZE * pixel_size;
	vec2 cell = floor(SCREEN_UV / px);
	vec3 c = texture(screen, (cell + 0.5) * px).rgb;
	ivec2 b = ivec2(mod(cell, 4.0));
	float d = BAYER[b.x][b.y] / 16.0 - 0.5;
	c = floor(c * levels + d + 0.5) / levels;
	COLOR = vec4(c, 1.0);
}
