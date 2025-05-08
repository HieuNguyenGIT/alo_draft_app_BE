const express = require("express");
const router = express.Router();
const db = require("../config/database");
const auth = require("../middleware/auth");

// Get all todos for a user
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [todos] = await db.query(
      "SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );

    res.json(todos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create a new todo
router.post("/", auth, async (req, res) => {
  try {
    const { title, description } = req.body;
    const userId = req.user.id;

    const [result] = await db.query(
      "INSERT INTO todos (user_id, title, description) VALUES (?, ?, ?)",
      [userId, title, description]
    );

    const [newTodo] = await db.query("SELECT * FROM todos WHERE id = ?", [
      result.insertId,
    ]);

    res.status(201).json(newTodo[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update a todo
router.put("/:id", auth, async (req, res) => {
  try {
    const { title, description, is_completed } = req.body;
    const todoId = req.params.id;
    const userId = req.user.id;

    // Check if todo belongs to user
    const [todos] = await db.query(
      "SELECT * FROM todos WHERE id = ? AND user_id = ?",
      [todoId, userId]
    );

    if (todos.length === 0) {
      return res.status(404).json({ message: "Todo not found" });
    }

    await db.query(
      "UPDATE todos SET title = ?, description = ?, is_completed = ? WHERE id = ?",
      [title, description, is_completed, todoId]
    );

    const [updatedTodo] = await db.query("SELECT * FROM todos WHERE id = ?", [
      todoId,
    ]);

    res.json(updatedTodo[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete a todo
router.delete("/:id", auth, async (req, res) => {
  try {
    const todoId = req.params.id;
    const userId = req.user.id;

    // Check if todo belongs to user
    const [todos] = await db.query(
      "SELECT * FROM todos WHERE id = ? AND user_id = ?",
      [todoId, userId]
    );

    if (todos.length === 0) {
      return res.status(404).json({ message: "Todo not found" });
    }

    await db.query("DELETE FROM todos WHERE id = ?", [todoId]);

    res.json({ message: "Todo deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
