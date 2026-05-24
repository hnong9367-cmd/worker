gexport default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS cho phép App kết nối
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Admin-Token",
    };
    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const res = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const isAdmin = request.headers.get("Admin-Token") === env.ADMIN_TOKEN;

    // --- HÀM CHUYỂN ĐỔI JSON (Hỗ trợ TẤT CẢ các định dạng Options) ---
    function flattenQuestions(list, quizId, parentId = null, order = { v: 0 }) {
      const qRows = [], oRows = [];
      for (const q of list) {
        qRows.push({
          question_id: q.id, 
          quiz_id: quizId, 
          parent_id: parentId,
          type: q.type || "multiple_choice",
          content: q.question || q.cau_hoi || "",
          material: q.materials ? JSON.stringify(q.materials) : null,
          sort_order: order.v++,
        });
        
        let opts = [];
        if (q.type === "multiple_true_false" && q.statements) {
          opts = q.statements.map(st => ({ id: st.id, content: st.text, is_correct: st.answer }));
        } else {
          if (Array.isArray(q.options)) {
            opts = q.options.map(o => ({ id: o.id, content: o.content || o.text, is_correct: (q.correct_answers || []).includes(o.id) }));
          } else if (q.options && typeof q.options === 'object') {
            opts = Object.entries(q.options).map(([key, val]) => ({ id: key, content: val, is_correct: (q.correct_answers || []).includes(key) }));
          }
        }

        opts.forEach((o, idx) => {
          oRows.push({ option_id: o.id, question_id: q.id, content: o.content, is_correct: o.is_correct ? 1 : 0, sort_order: idx });
        });
      }
      return { qRows, oRows };
    }

    try {
      // ================= NHÓM 1: PUBLIC / HỌC SINH =================
      
      // Hỗ trợ tìm kiếm tài khoản khi học sinh quên tên đăng nhập
      // Có thể truyền query dạng: /api/users/lookup?name=Nguyen
      if (path === "/api/users/lookup" && method === "GET") {
        const nameQuery = url.searchParams.get("name") || "";
        let results;
        if (nameQuery.trim() !== "") {
          const { results: filtered } = await env.DB.prepare(
            `SELECT display_name, username FROM users WHERE display_name LIKE ? ORDER BY display_name`
          ).bind(`%${nameQuery}%`).all();
          results = filtered;
        } else {
          const { results: allUsers } = await env.DB.prepare(
            `SELECT display_name, username FROM users ORDER BY display_name`
          ).all();
          results = allUsers;
        }
        return res({ success: true, data: results });
      }

      if (path === "/api/users/list" && method === "GET") {
        const { results } = await env.DB.prepare(`SELECT display_name, username FROM users ORDER BY display_name`).all();
        return res({ success: true, data: results });
      }
      
      // Đăng ký tài khoản (Học sinh tự chọn username, password, display_name. UID tự sinh từ phía máy chủ)
      if (path === "/api/register" && method === "POST") {
        const { username, password, display_name } = await request.json();
        
        if (!username || !password || !display_name) {
          return res({ error: "Vui lòng nhập đầy đủ: Tên đăng nhập, Mật khẩu và Tên hiển thị!" }, 400);
        }

        const cleanUsername = username.trim();

        // Kiểm tra xem tên đăng nhập đã được sử dụng chưa
        const existing = await env.DB.prepare(`SELECT 1 FROM users WHERE username=?`).bind(cleanUsername).first();
        if (existing) {
          return res({ error: "Tên đăng nhập đã tồn tại!" }, 400);
        }

        // Tạo UUID v4 ngẫu nhiên làm mã định danh người dùng duy nhất
        const user_id = crypto.randomUUID();

        await env.DB.prepare(`INSERT INTO users (user_id, username, password, display_name) VALUES (?,?,?,?)`)
          .bind(user_id, cleanUsername, password, display_name.trim()).run();
          
        return res({ success: true, message: "Đăng ký thành công!", user_id, username: cleanUsername });
      }

      if (path === "/api/login" && method === "POST") {
        const { username, password } = await request.json();
        const user = await env.DB.prepare(`SELECT user_id, username, display_name FROM users WHERE username=? AND password=?`)
          .bind(username, password).first();
        if (!user) return res({ error: "Sai tài khoản mật khẩu!" }, 401);
        return res({ success: true, user });
      }

      if (path === "/api/quiz/questions" && method === "GET") {
        const quizId = url.searchParams.get("quiz_id");
        const { results: qs } = await env.DB.prepare(`SELECT question_id, type, content, material FROM questions WHERE quiz_id=? ORDER BY sort_order`).bind(quizId).all();
        const { results: opts } = await env.DB.prepare(`SELECT o.option_id, o.question_id, o.content FROM question_options o JOIN questions q ON o.question_id=q.question_id WHERE q.quiz_id=? ORDER BY o.sort_order`).bind(quizId).all();
        
        const optMap = {}; opts.forEach(o => { (optMap[o.question_id] = optMap[o.question_id] || []).push({ id: o.option_id, content: o.content }); });
        const data = qs.map(q => ({ ...q, options: optMap[q.question_id] || [] }));
        return res({ success: true, data });
      }

      if (path === "/api/quiz/start" && method === "POST") {
        const { user_id, quiz_id, start_time } = await request.json();
        const { meta } = await env.DB.prepare(`INSERT INTO submissions (user_id, quiz_id, start_time) VALUES (?,?,?)`).bind(user_id, quiz_id, start_time).run();
        return res({ success: true, submission_id: meta.last_row_id });
      }

      if (path === "/api/quiz/submit" && method === "POST") {
        const { submission_id, end_time, answers } = await request.json();
        const qTypes = await env.DB.prepare(`SELECT question_id, type FROM questions WHERE quiz_id=(SELECT quiz_id FROM submissions WHERE submission_id=?)`).bind(submission_id).all();
        const typeMap = Object.fromEntries(qTypes.results.map(q => [q.question_id, q.type]));
        
        const stmts = Object.entries(answers).map(([qId, sel]) => env.DB.prepare(`INSERT INTO submission_answers (submission_id, question_id, question_type, selected_ids) VALUES (?,?,?,?)`).bind(submission_id, qId, typeMap[qId]||'multiple_choice', JSON.stringify(Array.isArray(sel)?sel:[sel])));
        stmts.push(env.DB.prepare(`UPDATE submissions SET end_time=?, status='submitted' WHERE submission_id=?`).bind(end_time, submission_id));
        await env.DB.batch(stmts);
        
        const result = await env.DB.prepare(`SELECT score, correct_count FROM quiz_results WHERE submission_id=?`).bind(submission_id).first();
        return res({ success: true, result });
      }

      if (path === "/api/quiz/leaderboard" && method === "GET") {
        const quizId = url.searchParams.get("quiz_id");
        const { results } = await env.DB.prepare(`
          SELECT u.display_name, r.score, r.correct_count, ROUND((JULIANDAY(r.end_time) - JULIANDAY(r.start_time))*1440, 2) as duration 
          FROM quiz_results r JOIN users u ON r.user_id = u.user_id 
          WHERE r.quiz_id=? ORDER BY r.score DESC, duration ASC LIMIT 50
        `).bind(quizId).all();
        return res({ success: true, data: results });
      }

      // ================= NHÓM 2: ADMIN =================
      if (path.startsWith("/api/admin/") && !isAdmin) return res({ error: "Lỗi Token Quản trị!" }, 403);

      // Admin - Xóa sạch toàn bộ dữ liệu trên hệ thống để làm sạch môi trường test
      if (path === "/api/admin/system/reset" && method === "POST") {
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM quiz_results`),
          env.DB.prepare(`DELETE FROM submission_answers`),
          env.DB.prepare(`DELETE FROM submissions`),
          env.DB.prepare(`DELETE FROM question_options`),
          env.DB.prepare(`DELETE FROM questions`),
          env.DB.prepare(`DELETE FROM users`),
          env.DB.prepare(`DELETE FROM app_config`),
          env.DB.prepare(`INSERT INTO app_config (key, value) VALUES ('version', '1.0.0'), ('quiz_minutes', '45')`)
        ]);
        return res({ success: true, message: "Hệ thống đã được xóa sạch dữ liệu và đưa về trạng thái ban đầu!" });
      }

      if (path === "/api/admin/users" && method === "GET") {
        const { results } = await env.DB.prepare(`SELECT user_id, username, display_name, password FROM users ORDER BY username`).all();
        return res({ success: true, data: results });
      }

      if (path === "/api/admin/users/delete" && method === "POST") {
        const { user_id } = await request.json();
        if (!user_id) return res({ error: "Thiếu user_id!" }, 400);
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM quiz_results WHERE user_id = ?`).bind(user_id),
          env.DB.prepare(`DELETE FROM submissions WHERE user_id = ?`).bind(user_id),
          env.DB.prepare(`DELETE FROM users WHERE user_id = ?`).bind(user_id)
        ]);
        return res({ success: true, message: "Xóa tài khoản và dữ liệu liên quan thành công!" });
      }

      if (path === "/api/admin/users/change-password" && method === "POST") {
        const { user_id, new_password } = await request.json();
        if (!user_id || !new_password) return res({ error: "Thiếu user_id hoặc mật khẩu mới!" }, 400);
        await env.DB.prepare(`UPDATE users SET password = ? WHERE user_id = ?`).bind(new_password, user_id).run();
        return res({ success: true, message: "Thay đổi mật khẩu thành công!" });
      }

      if (path === "/api/admin/users/update" && method === "POST") {
        const { user_id, username, display_name } = await request.json();
        if (!user_id) return res({ error: "Thiếu user_id!" }, 400);

        if (username) {
          const conflict = await env.DB.prepare(`SELECT 1 FROM users WHERE username = ? AND user_id != ?`).bind(username, user_id).first();
          if (conflict) {
            return res({ error: "Tên đăng nhập mới đã tồn tại trên hệ thống!" }, 400);
          }
        }

        let updates = [];
        let params = [];
        if (username !== undefined) { updates.push("username = ?"); params.push(username.trim()); }
        if (display_name !== undefined) { updates.push("display_name = ?"); params.push(display_name.trim()); }

        if (updates.length === 0) return res({ error: "Không có thông tin nào để thay đổi!" }, 400);

        params.push(user_id);
        const query = `UPDATE users SET ${updates.join(", ")} WHERE user_id = ?`;
        await env.DB.prepare(query).bind(...params).run();

        return res({ success: true, message: "Cập nhật tài khoản thành công!" });
      }

      if (path === "/api/admin/stats" && method === "GET") {
        const { results } = await env.DB.prepare(`SELECT * FROM view_full_results ORDER BY score DESC, duration_minutes ASC`).all();
        return res({ success: true, data: results });
      }

      if (path === "/api/admin/upload-quiz" && method === "PUT") {
        const { quiz_id, questions } = await request.json();
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM question_options WHERE question_id IN (SELECT question_id FROM questions WHERE quiz_id=?)`).bind(quiz_id),
          env.DB.prepare(`DELETE FROM questions WHERE quiz_id=?`).bind(quiz_id)
        ]);
        const { qRows, oRows } = flattenQuestions(questions, quiz_id);
        
        const qStmts = qRows.map(q => env.DB.prepare(`INSERT INTO questions (question_id, quiz_id, parent_id, type, content, material, sort_order) VALUES (?,?,?,?,?,?,?)`).bind(q.question_id, q.quiz_id, q.parent_id, q.type, q.content, q.material, q.sort_order));
        const oStmts = oRows.map(o => env.DB.prepare(`INSERT INTO question_options (option_id, question_id, content, is_correct, sort_order) VALUES (?,?,?,?,?)`).bind(o.option_id, o.question_id, o.content, o.is_correct, o.sort_order));
        
        await env.DB.batch([...qStmts, ...oStmts]);
        return res({ success: true, message: `Upload xong ${qRows.length} câu hỏi!` });
      }

      if (path === "/api/admin/review" && method === "GET") {
        const sid = url.searchParams.get("submission_id");
        const { results: answers } = await env.DB.prepare(`
          SELECT sa.question_id, q.content as question, sa.selected_ids, sa.correct_option_ids, sa.is_correct
          FROM submission_answers sa JOIN questions q ON sa.question_id = q.question_id
          WHERE sa.submission_id=?
        `).bind(sid).all();
        return res({ success: true, data: answers.map(a => ({...a, selected: JSON.parse(a.selected_ids), correct: JSON.parse(a.correct_option_ids)})) });
      }

      return res({ error: "Không tìm thấy Route" }, 404);
    } catch (err) {
      return res({ error: err.message, stack: err.stack }, 500);
    }
  }
};
