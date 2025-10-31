module.exports = function () {
    var express = require('express');
    var router = express.Router();
    var User = require('../models/user');
    var Task = require('../models/task');

    // Helper function to parse query parameters
    function parseQueryParams(req) {
        var query = {};
        var options = {};

        // where
        if (req.query.where) {
            try {
                query = JSON.parse(req.query.where);
            } catch (e) {
                return { error: "Invalid where parameter" };
            }
        }

        // sort
        if (req.query.sort) {
            try {
                options.sort = JSON.parse(req.query.sort);
            } catch (e) {
                return { error: "Invalid sort parameter" };
            }
        }

        // select
        if (req.query.select) {
            try {
                options.select = JSON.parse(req.query.select);
            } catch (e) {
                return { error: "Invalid select parameter" };
            }
        }

        // skip 
        if (req.query.skip) {
            options.skip = parseInt(req.query.skip);
        }

        // limit
        if (req.query.limit) {
            options.limit = parseInt(req.query.limit);
        } else {
            options.limit = 100;
        }

        // count
        if (req.query.count === 'true') {
            options.count = true;
        }

        return { query, options };
    }

    // Define routes
    const tasksRoute = router.route('/');
    const taskByIdRoute = router.route('/:id');

    // POST
    tasksRoute.post(function (req, res) {

        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Bad Request",
                data: "Name and deadline are required"
            });
        }

        var task = new Task();
        task.name = req.body.name;
        task.description = req.body.description || "";

        if (req.body.deadline && (typeof req.body.deadline === 'number' || /^\d+\.?\d*$/.test(req.body.deadline))) {
            task.deadline = new Date(parseInt(req.body.deadline));
        } else if (req.body.deadline) {
            task.deadline = new Date(req.body.deadline);
        } else {
            return res.status(400).json({
                message: "Bad Request",
                data: "Deadline is required"
            });
        }
        if (typeof req.body.completed === 'string') {
            task.completed = req.body.completed.toLowerCase() === 'true';
        } else if (req.body.completed !== undefined) {
            task.completed = !!req.body.completed;
        } else {
            task.completed = false;
        }
        task.assignedUser = req.body.assignedUser || "";
        task.assignedUserName = req.body.assignedUserName || "unassigned";

        task.save()
            .then(function (savedTask) {

                if (savedTask.assignedUser && !savedTask.completed) {
                    return User.findById(savedTask.assignedUser)
                        .then(function (user) {
                            if (user) {
                                savedTask.assignedUserName = user.name;
                                var taskIdString = savedTask._id.toString();

                                user.pendingTasks = user.pendingTasks.filter(
                                    taskId => taskId !== taskIdString
                                );
                                user.pendingTasks.push(taskIdString);
                                return user.save().then(function () {
                                    return savedTask.save();
                                });
                            }
                        })
                        .then(function () {
                            return savedTask;
                        });
                }
                return savedTask;
            })
            .then(function (task) {
                res.status(201).json({
                    message: "OK",
                    data: task
                });
            })
            .catch(function (err) {
                res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error creating task"
                });
            });
    });

    // Get all tasks
    tasksRoute.get(function (req, res) {
        // Debug: log query parameters
        console.log('GET /api/tasks - Query params:', req.query);
        console.log('GET /api/tasks - count param:', req.query.count, 'Type:', typeof req.query.count);
        
        var parsed = parseQueryParams(req);
        console.log('GET /api/tasks - Parsed options.count:', parsed.options ? parsed.options.count : 'N/A');
        if (parsed.error) {
            return res.status(400).json({
                message: "Bad Request",
                data: parsed.error
            });
        }

        var { query, options } = parsed;

        if (options.count) {
            Task.countDocuments(query)
                .then(function (count) {
                    res.status(200).json({
                        message: "OK",
                        data: count
                    });
                })
                .catch(function (err) {
                    res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error counting tasks"
                    });
                });
        } else {
            Task.find(query, null, options)
                .then(function (tasks) {
                    res.status(200).json({
                        message: "OK",
                        data: tasks
                    });
                })
                .catch(function (err) {
                    res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error retrieving tasks"
                    });
                });
        }
    });

    // Get task by ID
    taskByIdRoute.get(function (req, res) {
        var parsed = parseQueryParams(req);
        if (parsed.error) {
            return res.status(400).json({
                message: "Bad Request",
                data: parsed.error
            });
        }

        var { options } = parsed;
        var query = { _id: req.params.id };

        Task.findById(query._id, options.select)
            .then(function (task) {
                if (!task) {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "Task not found"
                    });
                }
                res.status(200).json({
                    message: "OK",
                    data: task
                });
            })
            .catch(function (err) {
                res.status(404).json({
                    message: "Not Found",
                    data: "Task not found"
                });
            });
    });

    // PUT
    taskByIdRoute.put(function (req, res) {

        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Bad Request",
                data: "Name and deadline are required"
            });
        }

        Task.findById(req.params.id)
            .then(function (task) {
                if (!task) {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "Task not found"
                    });
                }


                var oldAssignedUser = task.assignedUser;
                var oldCompleted = task.completed;


                task.name = req.body.name;
                task.description = req.body.description || "";

                if (typeof req.body.deadline === 'number' || /^\d+$/.test(req.body.deadline)) {
                    task.deadline = new Date(parseInt(req.body.deadline));
                } else {
                    task.deadline = new Date(req.body.deadline);
                }
                if (typeof req.body.completed === 'string') {
                    task.completed = req.body.completed.toLowerCase() === 'true';
                  } else {
                    task.completed = !!req.body.completed;
                  }
                task.assignedUser = req.body.assignedUser || "";
                task.assignedUserName = req.body.assignedUserName || "unassigned";

                task.oldAssignedUser = oldAssignedUser;
                task.oldCompleted = oldCompleted;

                return task.save();
            })
            .then(function (task) {
                // Remove task from old user's pending tasks
                if (task.oldAssignedUser && task.oldAssignedUser !== task.assignedUser) {
                    return User.findById(task.oldAssignedUser)
                        .then(function (oldUser) {
                            if (oldUser) {
                                oldUser.pendingTasks = oldUser.pendingTasks.filter(
                                    taskId => taskId !== task._id.toString()
                                );
                                return oldUser.save();
                            }
                        })
                        .then(function () {
                            return task;
                        });
                }
                return task;
            })
            .then(function (task) {

                if (task.completed && task.oldAssignedUser) {
                    // Remove from pending tasks if task is now completed
                    return User.findById(task.oldAssignedUser)
                        .then(function (user) {
                            if (user) {
                                user.pendingTasks = user.pendingTasks.filter(
                                    taskId => taskId !== task._id.toString()
                                );
                                return user.save();
                            }
                        })
                        .then(function () {
                            return task;
                        });
                } else if (task.assignedUser && !task.completed) {
                    // Add task to user's pending tasks
                    return User.findById(task.assignedUser)
                        .then(function (user) {
                            if (user) {
                                task.assignedUserName = user.name;
                                var taskIdString = task._id.toString();

                                user.pendingTasks = user.pendingTasks.filter(
                                    taskId => taskId !== taskIdString
                                );
                                user.pendingTasks.push(taskIdString);
                                return user.save().then(function () {
                                    return task.save();
                                });
                            }
                        })
                        .then(function () {
                            return task;
                        });
                }
                return task;
            })
            .then(function (task) {
                res.status(200).json({
                    message: "OK",
                    data: task
                });
            })
            .catch(function (err) {
                res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error updating task"
                });
            });
    });

    // DELETE
    taskByIdRoute.delete(function (req, res) {
        Task.findById(req.params.id)
            .then(function (task) {
                if (!task) {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "Task not found"
                    });
                }

                // Remove task from user's pending tasks
                if (task.assignedUser) {
                    return User.findById(task.assignedUser)
                        .then(function (user) {
                            if (user) {
                                user.pendingTasks = user.pendingTasks.filter(
                                    taskId => taskId !== task._id.toString()
                                );
                                return user.save();
                            }
                        })
                        .then(function () {
                            return Task.findByIdAndDelete(req.params.id);
                        });
                } else {
                    return Task.findByIdAndDelete(req.params.id);
                }
            })
            .then(function () {
                res.status(204).send();
            })
            .catch(function (err) {
                res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error deleting task"
                });
            });
    });

    return router;
};

