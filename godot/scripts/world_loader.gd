## Loads a compiled world tile (res://world/<area>.glb + .json + _ground.jpg) and dresses it.
class_name WorldLoader
extends Node3D

const BUILDING_SHADER := preload("res://shaders/building.gdshader")
const DECK_SHADER := preload("res://shaders/road_deck.gdshader")
const COLLIDERS: Array[String] = ["ground_", "kerb", "buildings", "bridge_", "street_props"]

var meta: Dictionary
var lamp_mat: StandardMaterial3D
var lamps: PackedVector3Array


func load_area(area: String) -> void:
	meta = JSON.parse_string(FileAccess.get_file_as_string("res://world/%s.json" % area))
	var root: Node3D = (load("res://world/%s.glb" % area) as PackedScene).instantiate()
	add_child(root)

	var ground := StandardMaterial3D.new()
	ground.albedo_texture = load("res://world/%s_ground.jpg" % area)
	ground.roughness = 0.92
	ground.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC

	var buildings := ShaderMaterial.new()
	buildings.shader = BUILDING_SHADER
	var deck := ShaderMaterial.new()
	deck.shader = DECK_SHADER

	lamp_mat = StandardMaterial3D.new()
	lamp_mat.albedo_color = Color(0.95, 0.9, 0.8)
	lamp_mat.emission_enabled = true
	lamp_mat.emission = Color(1.0, 0.8, 0.55)
	lamp_mat.emission_energy_multiplier = 0.0

	var trees := {}
	for mi: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		var n := String(mi.name)
		if n.begins_with("tree_"):
			trees[int(n.get_slice("_", 1))] = mi.mesh
			mi.queue_free()
		elif n.begins_with("ground_"):
			mi.material_override = ground
		elif n.begins_with("buildings"):
			mi.material_override = buildings
		elif n.begins_with("bridge_deck"):
			mi.material_override = deck
		elif n.begins_with("lamp_heads"):
			mi.material_override = lamp_mat
		else:
			mi.material_override = _vertex_color_mat(0.9)
		if COLLIDERS.any(func(p: String) -> bool: return n.begins_with(p)):
			_add_trimesh_body(mi)
	_spawn_trees(trees)
	for l in meta.get("lamps", []):
		lamps.append(Vector3(l[0], l[1], l[2]))
	_add_backdrop()


func set_night(amount: float) -> void:
	RenderingServer.global_shader_parameter_set("night", amount)
	lamp_mat.emission_energy_multiplier = 6.0 * amount


func spawn_transform() -> Transform3D:
	var s: Dictionary = meta["spawn"]
	var p: Array = s["pos"]
	var d: Array = s["dir"]
	var fwd := Vector3(d[0], 0, d[2]).normalized()
	return Transform3D(Basis.looking_at(-fwd, Vector3.UP), Vector3(p[0], p[1], p[2]))


func path(name: String) -> PackedVector3Array:
	var out := PackedVector3Array()
	for p in meta["paths"].get(name, []):
		out.append(Vector3(p[0], p[1], p[2]))
	return out


func bounds_center() -> Vector3:
	var b: Array = meta["bbox_m"]
	return Vector3((b[0] + b[2]) * 0.5, 0, -(b[1] + b[3]) * 0.5)


func _vertex_color_mat(rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.vertex_color_is_srgb = true
	m.roughness = rough
	return m


func _add_trimesh_body(mi: MeshInstance3D) -> void:
	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	shape.shape = mi.mesh.create_trimesh_shape()
	body.add_child(shape)
	mi.add_child(body)


func _spawn_trees(templates: Dictionary) -> void:
	var by_variant := {}
	for t in meta.get("trees", []):
		by_variant.get_or_add(int(t[5]), []).append(t)
	var trunks := StaticBody3D.new()
	add_child(trunks)
	var trunk_shape := CylinderShape3D.new()
	trunk_shape.radius = 0.25
	trunk_shape.height = 3.0
	var mat := _vertex_color_mat(0.95)
	for v in by_variant:
		if not templates.has(v):
			continue
		var list: Array = by_variant[v]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = templates[v]
		mm.instance_count = list.size()
		for i in list.size():
			var t: Array = list[i]
			var pos := Vector3(t[0], t[1], t[2])
			var b := Basis(Vector3.UP, t[3]).scaled(Vector3.ONE * float(t[4]))
			mm.set_instance_transform(i, Transform3D(b, pos))
			var cs := CollisionShape3D.new()
			cs.shape = trunk_shape
			cs.position = pos + Vector3(0, 1.5, 0)
			trunks.add_child(cs)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = mat
		add_child(mmi)


func _add_backdrop() -> void:
	var plane := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(6000, 6000)
	plane.mesh = pm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.42, 0.4, 0.37)
	m.roughness = 1.0
	plane.material_override = m
	plane.position = bounds_center() + Vector3(0, -1.5, 0)
	add_child(plane)
