## Entry point: loads a world tile, spawns the car, camera, lighting and HUD.
## User args (after `--`): --area=<name>  --shots=<dir>  --demo
extends Node3D

const LAMP_POOL := 16

var world: WorldLoader
var car: Car
var cam: CameraRig
var sun: DirectionalLight3D
var env: Environment
var sky_mat: ProceduralSkyMaterial
var hud: Label
var retro: ColorRect
var night := false

var _lamp_lights: Array[OmniLight3D] = []
var _lamp_timer := 0.0
var _args := {}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else ""
	_setup_input()
	_setup_environment()

	world = WorldLoader.new()
	add_child(world)
	world.load_area(_args.get("area", "rincon"))

	car = Car.new()
	add_child(car)
	car.reset_to(world.spawn_transform())

	cam = CameraRig.new()
	cam.target = car
	cam.orbit_center = world.bounds_center() + Vector3(0, 20, 0)
	add_child(cam)
	cam.make_current()
	cam.snap()

	for i in LAMP_POOL:
		var l := OmniLight3D.new()
		l.omni_range = 20.0
		l.light_energy = 4.0
		l.light_color = Color(1.0, 0.78, 0.5)
		l.visible = false
		add_child(l)
		_lamp_lights.append(l)

	_setup_overlay()
	set_night(false)

	if _args.has("shots"):
		_run_shots(_args["shots"])
	elif _args.has("demo"):
		_run_demo()


func _process(delta: float) -> void:
	_lamp_timer -= delta
	if night and _lamp_timer <= 0.0:
		_lamp_timer = 0.25
		_place_lamp_lights()
	var kmh := car.linear_velocity.length() * 3.6
	hud.text = "%d KM/H   [%s]\nWASD drive  SPACE handbrake  C camera  N night  P retro  R reset  T autopilot" % [
		kmh, CameraRig.Mode.keys()[cam.mode]]


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("camera"):
		cam.cycle()
	elif event.is_action_pressed("night"):
		set_night(not night)
	elif event.is_action_pressed("retro"):
		retro.visible = not retro.visible
	elif event.is_action_pressed("reset"):
		car.autopilot_path = PackedVector3Array()
		car.reset_to(world.spawn_transform())
	elif event.is_action_pressed("autopilot"):
		if car.autopilot_path.is_empty():
			car.reset_to(world.spawn_transform())
			car.follow(world.path("street"), 15.0)
		else:
			car.autopilot_path = PackedVector3Array()


func set_night(on: bool) -> void:
	night = on
	world.set_night(1.0 if on else 0.0)
	car.set_headlights(on)
	if on:
		sun.light_energy = 0.12
		sun.light_color = Color(0.55, 0.62, 1.0)
		sky_mat.sky_top_color = Color(0.02, 0.03, 0.08)
		sky_mat.sky_horizon_color = Color(0.14, 0.1, 0.2)
		sky_mat.ground_horizon_color = Color(0.1, 0.08, 0.14)
		env.ambient_light_energy = 0.7
		env.fog_light_color = Color(0.08, 0.07, 0.14)
	else:
		sun.light_energy = 1.1
		sun.light_color = Color(1.0, 0.88, 0.72)
		sky_mat.sky_top_color = Color(0.3, 0.46, 0.72)
		sky_mat.sky_horizon_color = Color(0.78, 0.72, 0.66)
		sky_mat.ground_horizon_color = Color(0.5, 0.46, 0.42)
		env.ambient_light_energy = 0.45
		env.fog_light_color = Color(0.72, 0.68, 0.66)
	for l in _lamp_lights:
		l.visible = on
	if on:
		_place_lamp_lights()


func _place_lamp_lights() -> void:
	var focus := cam.global_position if cam.mode == CameraRig.Mode.ORBIT else car.global_position
	var lamps := Array(world.lamps)
	lamps.sort_custom(func(a: Vector3, b: Vector3) -> bool:
		return a.distance_squared_to(focus) < b.distance_squared_to(focus))
	for i in _lamp_lights.size():
		_lamp_lights[i].visible = i < lamps.size()
		if i < lamps.size():
			_lamp_lights[i].global_position = lamps[i]


func _setup_input() -> void:
	var binds := {
		"accelerate": [KEY_W, KEY_UP], "brake": [KEY_S, KEY_DOWN], "steer_left": [KEY_A, KEY_LEFT],
		"steer_right": [KEY_D, KEY_RIGHT], "handbrake": [KEY_SPACE], "camera": [KEY_C], "night": [KEY_N],
		"retro": [KEY_P], "reset": [KEY_R], "autopilot": [KEY_T],
	}
	for action in binds:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for key in binds[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = key
			InputMap.action_add_event(action, ev)


func _setup_environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	sky_mat = ProceduralSkyMaterial.new()
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 0.9
	env.ssao_enabled = true
	env.ssao_radius = 2.0
	env.ssao_intensity = 2.5
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.05
	env.fog_enabled = true
	env.fog_density = 0.0005
	env.fog_aerial_perspective = 0.4
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.12
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-42, -38, 0)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 420.0
	sun.shadow_blur = 1.5
	add_child(sun)


func _setup_overlay() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	retro = ColorRect.new()
	retro.set_anchors_preset(Control.PRESET_FULL_RECT)
	retro.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sm := ShaderMaterial.new()
	sm.shader = preload("res://shaders/retro.gdshader")
	retro.material = sm
	retro.visible = false
	layer.add_child(retro)
	hud = Label.new()
	hud.position = Vector2(16, 12)
	hud.add_theme_font_size_override("font_size", 15)
	hud.add_theme_color_override("font_outline_color", Color.BLACK)
	hud.add_theme_constant_override("outline_size", 5)
	layer.add_child(hud)


func _wait(seconds: float) -> void:
	await get_tree().create_timer(seconds, true, true).timeout


## Renders a fixed set of views to PNGs for quick visual validation, then quits.
func _run_shots(dir: String) -> void:
	DirAccess.make_dir_recursive_absolute(dir)
	hud.visible = false
	var street := world.path("street")
	var freeway := world.path("freeway")
	var views := [
		["01_overview_day", func() -> void: cam.mode = CameraRig.Mode.ORBIT],
		["02_topdown_day", func() -> void:
			cam.mode = CameraRig.Mode.TOP_DOWN
			car.follow(street, 14.0)],
		["03_chase_day", func() -> void: cam.mode = CameraRig.Mode.CHASE],
		["04_freeway_chase", func() -> void:
			if freeway.size() > 4:
				var p := freeway[2]
				car.reset_to(Transform3D(Basis.looking_at(-(freeway[4] - p).normalized()), p + Vector3.UP))
				car.follow(freeway, 20.0)],
		["05_freeway_topdown", func() -> void: cam.mode = CameraRig.Mode.TOP_DOWN],
		["06_night_topdown", func() -> void:
			car.reset_to(world.spawn_transform())
			car.follow(street, 14.0)
			set_night(true)],
		["07_night_chase", func() -> void: cam.mode = CameraRig.Mode.CHASE],
		["08_night_overview", func() -> void: cam.mode = CameraRig.Mode.ORBIT],
		["09_retro_topdown", func() -> void:
			set_night(false)
			cam.mode = CameraRig.Mode.TOP_DOWN
			retro.visible = true],
	]
	for v in views:
		v[1].call()
		await _wait(float(_args.get("settle", "3")))
		cam.snap()
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [dir, v[0]])
		print("shot %s  car=%s  speed=%.1f" % [v[0], car.global_position, car.linear_velocity.length()])
	get_tree().quit()


## Scripted fly-through for recording with --write-movie.
func _run_demo() -> void:
	hud.visible = false
	var street := world.path("street")
	var freeway := world.path("freeway")
	cam.mode = CameraRig.Mode.ORBIT
	await _wait(7.0)
	cam.mode = CameraRig.Mode.TOP_DOWN
	cam.snap()
	car.follow(street, 15.0)
	await _wait(9.0)
	cam.mode = CameraRig.Mode.CHASE
	await _wait(7.0)
	if freeway.size() > 4:
		var p := freeway[2]
		car.reset_to(Transform3D(Basis.looking_at(-(freeway[4] - p).normalized()), p + Vector3.UP))
		car.follow(freeway, 22.0)
		cam.snap()
		await _wait(8.0)
	set_night(true)
	car.reset_to(world.spawn_transform())
	car.follow(street, 15.0)
	cam.mode = CameraRig.Mode.TOP_DOWN
	cam.snap()
	await _wait(8.0)
	cam.mode = CameraRig.Mode.ORBIT
	retro.visible = true
	await _wait(6.0)
	get_tree().quit()
