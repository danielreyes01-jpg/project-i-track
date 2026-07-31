(function () {
	const nativeFetch = window.fetch.bind(window);
	function jsonResponse(payload, status) {
		return new Response(JSON.stringify(payload), { status: status || 200, headers: { "Content-Type": "application/json" } });
	}
	window.fetch = async function (input, init) {
		const url = String(typeof input === "string" ? input : (input && input.url) || "");
		const response = await nativeFetch(input, init);
		if (response.status !== 404) return response;
		if (url.includes("/api/student/profile")) {
			const meResponse = await nativeFetch("/api/auth/me", init);
			if (!meResponse.ok) return meResponse;
			const me = await meResponse.json();
			return jsonResponse({
				user: me.user || {},
				modules: Array.from({ length: 10 }, (_, index) => ({ module_no: index + 1, module_title: "Learning Module " + (index + 1), status: "not_answered", answered_at: null })),
				attendance: []
			});
		}
		if (url.includes("/api/admin/student-attention")) {
			const usersResponse = await nativeFetch("/api/admin/users", init);
			if (!usersResponse.ok) return usersResponse;
			const payload = await usersResponse.json();
			const students = (Array.isArray(payload.users) ? payload.users : []).filter((user) => String(user.role || "").toLowerCase() === "student" && Boolean(user.approved)).map((user) => ({ id: user.id, name: [user.firstname, user.lastname].filter(Boolean).join(" "), lrn: user.lrn || "", school: user.school || "" }));
			return jsonResponse({ count: students.length, students });
		}
		return response;
	};
})();
