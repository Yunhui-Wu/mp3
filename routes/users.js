module.exports = function () {
    var express = require('express');
    var router = express.Router(); 
    var User = require('../models/user');
    var Task = require('../models/task');
    var mongoose = require('mongoose');

    // Define routes
    const usersRoute = router.route('/');
    const userByIdRoute = router.route('/:id');

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
        }

        // count
        if (req.query.count === 'true') {
            options.count = true;
        }

        return { query, options };
    }

    // Create new user
    usersRoute.post(async function (req, res) {

        const newUser = new User(req.body);
        const err = newUser.validateSync();
        
        if (err) {
            // Check for specific validation errors without exposing Mongoose details
            var errorMessage = "Validation error";
            if (err.errors) {
                var errorFields = Object.keys(err.errors);
                if (errorFields.length > 0) {
                    var missingFields = errorFields.filter(function(field) {
                        return err.errors[field].kind === 'required';
                    });
                    if (missingFields.length > 0) {
                        errorMessage = missingFields.join(' and ') + ' is required';
                    }
                }
            }
            return res.status(400).json({
                message: "Bad Request",
                data: errorMessage
            });
        }

        try {
            // POST user only creates a single document, no transaction needed
            const savedUser = await newUser.save();
            
            res.status(201).json({
                message: "OK",
                data: savedUser
            });
        } catch (e) {
            if (e.code === 11000) {
                return res.status(400).json({
                    message: "Bad Request",
                    data: "Email already exists"
                });
            }
            res.status(500).json({
                message: "Internal Server Error",
                data: "Error creating user"
            });
        }
    });

    // Get all users
    usersRoute.get(async function (req, res) {

        const query = User.find();

        // Add query conditions
        if (req.query.where) {
            try {
                const whereCondition = JSON.parse(req.query.where);
                query.where(whereCondition);
            } catch (e) {
                return res.status(400).json({
                    message: "Bad Request",
                    data: "Invalid where parameter"
                });
            }
        }

        if (req.query.sort) {
            try {
                const sortCondition = JSON.parse(req.query.sort);
                query.sort(sortCondition);
            } catch (e) {
                return res.status(400).json({
                    message: "Bad Request",
                    data: "Invalid sort parameter"
                });
            }
        }

        if (req.query.select) {
            try {
                const selectCondition = JSON.parse(req.query.select);
                query.select(selectCondition);
            } catch (e) {
                return res.status(400).json({
                    message: "Bad Request",
                    data: "Invalid select parameter"
                });
            }
        }

        if (req.query.skip) {
            query.skip(parseInt(req.query.skip));
        }

        if (req.query.limit) {
            query.limit(parseInt(req.query.limit));
        }

        // count
        if (req.query.count === 'true') {
            try {
                const countQuery = User.countDocuments();
                if (req.query.where) {
                    const whereCondition = JSON.parse(req.query.where);
                    countQuery.where(whereCondition);
                }
                const count = await countQuery.exec();
                res.status(200).json({
                    message: "OK",
                    data: count
                });
            } catch (err) {
                res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error counting users"
                });
            }
        } else {
            try {
                const result = await query.exec();
                res.status(200).json({
                    message: "OK",
                    data: result
                });
            } catch (err) {
                res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error retrieving users"
                });
            }
        }
    });

    // Get user by ID
    userByIdRoute.get(function (req, res) {
        var parsed = parseQueryParams(req);
        if (parsed.error) {
            return res.status(400).json({
                message: "Bad Request",
                data: parsed.error
            });
        }

        var { options } = parsed;
        var query = { _id: req.params.id };

        User.findById(query._id, options.select)
            .then(function (user) {
                if (!user) {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "User not found"
                    });
                }
                res.status(200).json({
                    message: "OK",
                    data: user
                });
            })
            .catch(function (err) {
                res.status(404).json({
                    message: "Not Found",
                    data: "User not found"
                });
            });
    });

    // PUT
    userByIdRoute.put(async function (req, res) {

        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Bad Request",
                data: "Name and email are required"
            });
        }

        if (req.body.pendingTasks !== undefined) {
            if (!Array.isArray(req.body.pendingTasks)) {
                return res.status(400).json({
                    message: "Bad Request",
                    data: "pendingTasks must be an array"
                });
            }
            var invalidId = req.body.pendingTasks.find(function (id) {
                return !mongoose.Types.ObjectId.isValid(id);
            });
            if (invalidId) {
                return res.status(400).json({
                    message: "Bad Request",
                    data: "Invalid task id in pendingTasks: " + invalidId
                });
            }
        }

        var session = await mongoose.startSession();
        try {
            var resultUser;
            await session.withTransaction(async function () {
                var user = await User.findById(req.params.id).session(session);
                if (!user) {
                    var notFound = new Error('User not found');
                    notFound.statusCode = 404;
                    throw notFound;
                }

                var oldPendingTasks = Array.isArray(user.pendingTasks) ? user.pendingTasks.slice() : [];

                // Apply updates
                user.name = req.body.name;
                user.email = req.body.email;

                var newPendingTasks = req.body.pendingTasks || [];
                user.pendingTasks = newPendingTasks.filter(function(taskId, index, self) {
                    return self.indexOf(taskId) === index;
                });

                await user.save({ session: session });

                // Update assignedUserName in all tasks assigned to this user (including completed ones)
                await Task.updateMany(
                    { assignedUser: user._id.toString() },
                    { assignedUserName: user.name },
                    { session: session }
                );

                // Update pendingTasks: assign tasks that are in new pendingTasks
                if (user.pendingTasks.length) {
                    await Task.updateMany(
                        { _id: { $in: user.pendingTasks } },
                        { assignedUser: user._id.toString(), assignedUserName: user.name },
                        { session: session }
                    );
                }

                // Unassign tasks that were removed from pendingTasks
                var removedTaskIds = oldPendingTasks.filter(function (taskId) {
                    return !user.pendingTasks.includes(taskId);
                });
                if (removedTaskIds.length) {
                    await Task.updateMany(
                        { _id: { $in: removedTaskIds } },
                        { assignedUser: "", assignedUserName: "unassigned" },
                        { session: session }
                    );
                }

                resultUser = user;
            });

            res.status(200).json({
                message: "OK",
                data: resultUser
            });
        } catch (err) {
            if (err.statusCode === 404) {
                return res.status(404).json({
                    message: "Not Found",
                    data: "User not found"
                });
            }
            if (err.code === 11000) {
                return res.status(400).json({
                    message: "Bad Request",
                    data: "Email already exists"
                });
            }
            if (err.name === 'CastError') {
                return res.status(400).json({
                    message: "Bad Request",
                    data: "Invalid id format"
                });
            }
            res.status(500).json({
                message: "Internal Server Error",
                data: "Error updating user"
            });
        } finally {
            session.endSession();
        }
    });

    // DELETE
    userByIdRoute.delete(function (req, res) {
        User.findById(req.params.id)
            .then(function (user) {
                if (!user) {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "User not found"
                    });
                }

                // Unassign all pending tasks
                return Task.updateMany(
                    { _id: { $in: user.pendingTasks } },
                    { 
                        assignedUser: "",
                        assignedUserName: "unassigned"
                    }
                ).then(function () {
                    return User.findByIdAndDelete(req.params.id);
                });
            })
            .then(function () {
                res.status(204).send();
            })
            .catch(function (err) {
                res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error deleting user"
                });
            });
    });

    return router;
};

