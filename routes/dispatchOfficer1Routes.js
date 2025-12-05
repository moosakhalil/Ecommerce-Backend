// routes/dispatchOfficer1Routes.js - Complete Dispatch Officer 1 routes
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const DeliveryTracking = require("../models/Deliverytracking");
const VehicleType = require("../models/VehicleType");
const Employee = require("../models/Employee"); // ✅ Import Employee schema

// Helper function to get workflow progress
function getWorkflowProgress(tracking) {
  if (
    tracking.getWorkflowProgress &&
    typeof tracking.getWorkflowProgress === "function"
  ) {
    return tracking.getWorkflowProgress();
  }

  const workflow = tracking.workflowStatus || {};
  return {
    pending: workflow.pending?.completed || false,
    packed: workflow.packed?.completed || false,
    storage: workflow.storage?.completed || false,
    assigned: workflow.assigned?.completed || false,
    loaded: workflow.loaded?.completed || false,
    inTransit: workflow.inTransit?.completed || false,
    delivered: workflow.delivered?.completed || false,
  };
}

// Helper function to calculate order requirements
function calculateOrderRequirements(order) {
  const items = order.items || [];

  let totalVolume = 0;
  let totalWeight = 0;
  let totalPackages = items.length;

  items.forEach((item) => {
    // Estimate volume based on quantity (rough estimate)
    totalVolume += (item.quantity || 1) * 0.1; // 0.1 cubic meters per item

    // Extract weight from weight string if available
    if (item.weight) {
      const weightMatch = item.weight.match(/(\d+(?:\.\d+)?)/);
      if (weightMatch) {
        totalWeight += parseFloat(weightMatch[1]) * (item.quantity || 1);
      }
    } else {
      // Default weight estimate
      totalWeight += (item.quantity || 1) * 0.5; // 0.5 kg per item
    }
  });

  return {
    volume: Math.round(totalVolume * 100) / 100, // Round to 2 decimal places
    weight: Math.round(totalWeight * 100) / 100,
    packages: totalPackages,
  };
}

// Helper function to suggest best vehicle
function suggestVehicle(orderRequirements, availableVehicles) {
  const suitable = availableVehicles.filter(
    (vehicle) =>
      vehicle.specifications.maxVolume >= orderRequirements.volume &&
      vehicle.specifications.maxWeight >= orderRequirements.weight &&
      vehicle.specifications.maxPackages >= orderRequirements.packages
  );

  if (suitable.length === 0) return null;

  // Sort by efficiency (smallest vehicle that can handle the load)
  return suitable.sort((a, b) => {
    const aEfficiency =
      a.specifications.maxVolume +
      a.specifications.maxWeight +
      a.specifications.maxPackages;
    const bEfficiency =
      b.specifications.maxVolume +
      b.specifications.maxWeight +
      b.specifications.maxPackages;
    return aEfficiency - bEfficiency;
  })[0];
}

// Get assignment queue - orders ready for vehicle assignment
router.get("/queue", async (req, res) => {
  try {
    // ✅ FIXED: Status check - Storage officer sets "ready-to-pickup" (with hyphen)
    const customers = await Customer.find({
      "shoppingHistory.status": "ready-to-pickup",
    }).lean();

    let assignmentQueue = [];

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (order.status === "ready-to-pickup") {
          // Get delivery tracking for workflow status
          let tracking = await DeliveryTracking.findOne({
            orderId: order.orderId,
          });

          if (!tracking) {
            tracking = await DeliveryTracking.createFromCustomerOrder(
              customer,
              order
            );
          }

          // Only include orders that completed storage but not yet assigned
          const progress = getWorkflowProgress(tracking);
          if (progress.storage && !progress.assigned) {
            // Calculate order requirements
            const requirements = calculateOrderRequirements(order);

            // Calculate priority based on order amount and delivery time
            const totalAmount = order.totalAmount || 0;
            const deliveryTime = new Date(order.deliveryDate || Date.now());
            const hoursUntilDelivery =
              (deliveryTime - new Date()) / (1000 * 60 * 60);

            let priority =
              totalAmount >= 200
                ? "high"
                : totalAmount >= 100
                ? "medium"
                : "low";
            if (hoursUntilDelivery <= 4) priority = "high"; // Urgent if delivery soon

            assignmentQueue.push({
              orderId: order.orderId,
              customerName: customer.name,
              customerPhone: customer.phoneNumber[0] || "",
              priority: priority,
              deliveryDate: order.deliveryDate,
              timeSlot: order.timeSlot || "",
              deliveryAddress: {
                area: order.deliveryAddress?.area || "",
                fullAddress: order.deliveryAddress?.fullAddress || "",
              },
              requirements: requirements,
              totalAmount: order.totalAmount,
              itemsCount: order.items ? order.items.length : 0,
              specialInstructions: order.adminReason || "",
              storageLocation: order.storageDetails?.storageLocation || "",
              hoursUntilDelivery: Math.round(hoursUntilDelivery),
              isUrgent: hoursUntilDelivery <= 4,
            });
          }
        }
      }
    }

    // Sort by priority and delivery time
    assignmentQueue.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff =
        priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      return new Date(a.deliveryDate) - new Date(b.deliveryDate);
    });

    res.json(assignmentQueue);
  } catch (error) {
    console.error("Error fetching assignment queue:", error);
    res.status(500).json({ error: "Failed to fetch assignment queue" });
  }
});

// Get available vehicles with specifications
router.get("/vehicles", async (req, res) => {
  try {
    const vehicles = await VehicleType.find({ isActive: true }).lean();

    // Format vehicles for dispatch officer
    const formattedVehicles = vehicles.map((vehicle) => ({
      id: vehicle._id,
      name: vehicle.name,
      displayName: vehicle.displayName,
      category: vehicle.category,
      specifications: vehicle.specifications,
      description: vehicle.description,
      // Add availability status (this could be enhanced with real-time tracking)
      status: "available", // Default to available for now
    }));

    res.json(formattedVehicles);
  } catch (error) {
    console.error("Error fetching vehicles:", error);
    res.status(500).json({ error: "Failed to fetch vehicles" });
  }
});

// Get vehicle suggestion for order
router.get("/suggest-vehicle/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    // Find the order
    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);

    // Calculate order requirements
    const requirements = calculateOrderRequirements(order);

    // Get available vehicles
    const vehicles = await VehicleType.find({ isActive: true }).lean();

    // Suggest best vehicle
    const suggestedVehicle = suggestVehicle(requirements, vehicles);

    res.json({
      orderRequirements: requirements,
      suggestedVehicle: suggestedVehicle,
      allVehicles: vehicles.map((v) => ({
        ...v,
        suitable:
          v.specifications.maxVolume >= requirements.volume &&
          v.specifications.maxWeight >= requirements.weight &&
          v.specifications.maxPackages >= requirements.packages,
      })),
    });
  } catch (error) {
    console.error("Error suggesting vehicle:", error);
    res.status(500).json({ error: "Failed to suggest vehicle" });
  }
});

// ✅ SIMPLIFIED: Get all employees (no strict filters)
router.get("/dispatch-officers", async (req, res) => {
  try {
    console.log("=== FETCHING ALL EMPLOYEES ===");

    // Fetch ALL employees - no filters
    const employees = await Employee.find({});

    console.log("Total employees found:", employees.length);
    console.log(
      "Employees:",
      employees.map((e) => ({
        id: e.employeeId,
        name: e.name,
        roles: e.roles,
        activated: e.isActivated,
        blocked: e.isBlocked,
        status: e.availability?.status,
        assignments: e.currentAssignments,
      }))
    );

    // Map employees to dispatch officer format
    const dispatchOfficers = employees.map((emp) => ({
      employeeId: emp.employeeId,
      employeeName: emp.name,
      phone: emp.phone?.[0] || "",
      currentAssignments: emp.currentAssignments || 0,
      maxAssignments: emp.maxAssignments || 5,
      expertise: emp.roles || [],
      status: emp.availability?.status || "available",
      rating: emp.performanceMetrics?.rating || 5,
      completedOrders: emp.performanceMetrics?.completedOrders || 0,
      email: emp.email,
      isActivated: emp.isActivated,
      isBlocked: emp.isBlocked,
    }));

    console.log("Mapped officers:", dispatchOfficers.length);

    // Filter: Only show available, not blocked, activated employees
    const availableOfficers = dispatchOfficers.filter(
      (officer) =>
        officer.isActivated &&
        !officer.isBlocked &&
        officer.currentAssignments < officer.maxAssignments
    );

    console.log("Available officers:", availableOfficers.length);

    res.json({
      available: availableOfficers.sort(
        (a, b) => a.currentAssignments - b.currentAssignments
      ),
      all: dispatchOfficers, // Show ALL employees
    });
  } catch (error) {
    console.error("Error fetching dispatch officers:", error);
    res.status(500).json({
      error: "Failed to fetch dispatch officers",
      details: error.message,
    });
  }
});

// Get detailed order for assignment
router.get("/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);

    // Get delivery tracking
    const tracking = await DeliveryTracking.findOne({ orderId: orderId });

    // Calculate requirements
    const requirements = calculateOrderRequirements(order);

    const orderDetails = {
      orderId: order.orderId,
      customerName: customer.name,
      customerPhone: customer.phoneNumber[0] || "",
      status: order.status,
      deliveryDate: order.deliveryDate,
      timeSlot: order.timeSlot,
      deliveryAddress: order.deliveryAddress,
      specialInstructions: order.adminReason || "",
      items: order.items || [],
      requirements: requirements,
      totalAmount: order.totalAmount,
      packingDetails: order.packingDetails || {},
      storageDetails: order.storageDetails || {},
      workflowProgress: tracking ? getWorkflowProgress(tracking) : {},
      assignmentDetails: order.assignmentDetails || {
        assignedVehicle: null,
        assignedDriver: null,
        assignedAt: null,
        assignedBy: null,
        notes: "",
      },
    };

    res.json(orderDetails);
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Failed to fetch order details" });
  }
});

// Assign vehicle and driver to order
router.post("/assign/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      vehicleId,
      driverDetails,
      assignmentNotes,
      employeeId,
      employeeName,
    } = req.body;

    // Validate required fields
    if (!vehicleId || !driverDetails || !employeeId || !employeeName) {
      return res.status(400).json({
        error: "Vehicle, driver, and employee details are required",
      });
    }

    // Find the order
    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const orderIndex = customer.shoppingHistory.findIndex(
      (o) => o.orderId === orderId
    );
    const order = customer.shoppingHistory[orderIndex];

    // Get vehicle details
    const vehicle = await VehicleType.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: "Vehicle not found" });
    }

    // Verify order requirements against vehicle capacity
    const requirements = calculateOrderRequirements(order);
    if (
      requirements.volume > vehicle.specifications.maxVolume ||
      requirements.weight > vehicle.specifications.maxWeight ||
      requirements.packages > vehicle.specifications.maxPackages
    ) {
      return res.status(400).json({
        error: "Order requirements exceed vehicle capacity",
      });
    }

    // Update order with assignment details
    const assignmentData = {
      assignedVehicle: {
        vehicleId: vehicleId,
        vehicleName: vehicle.name,
        displayName: vehicle.displayName,
        category: vehicle.category,
        specifications: vehicle.specifications,
      },
      assignedDriver: driverDetails,
      assignedAt: new Date(),
      assignedBy: {
        employeeId: employeeId,
        employeeName: employeeName,
      },
      notes: assignmentNotes || "",
    };

    // Update customer order
    customer.shoppingHistory[orderIndex].assignmentDetails = assignmentData;
    customer.shoppingHistory[orderIndex].status = "assigned-dispatch-officer-2";
    customer.shoppingHistory[orderIndex].driver1 = driverDetails.employeeName;

    await customer.save();

    // ✅ Update Employee record - increment currentAssignments
    // Use employeeId (not _id) to find employee
    await Employee.findOneAndUpdate(
      { employeeId: driverDetails.employeeId },
      {
        $inc: { currentAssignments: 1 },
        "availability.lastStatusUpdate": new Date(),
      }
    );

    // Update delivery tracking workflow
    const tracking = await DeliveryTracking.findOne({ orderId: orderId });
    if (tracking) {
      tracking.workflowStatus.assigned.completed = true;
      tracking.workflowStatus.assigned.completedAt = new Date();
      tracking.workflowStatus.assigned.assignedDriver = driverDetails;
      tracking.workflowStatus.assigned.assignedBy = {
        employeeId: employeeId,
        employeeName: employeeName,
      };

      // Update current status
      tracking.currentStatus = "assigned-dispatch-officer-2";

      await tracking.save();
    }

    res.json({
      success: true,
      message: `Order ${orderId} assigned successfully`,
      assignmentDetails: assignmentData,
      newStatus: "assigned-dispatch-officer-2",
    });
  } catch (error) {
    console.error("Error assigning order:", error);
    res.status(500).json({ error: "Failed to assign order" });
  }
});

// Get assignment statistics
router.get("/stats", async (req, res) => {
  try {
    const customers = await Customer.find({
      "shoppingHistory.status": {
        $in: ["ready-to-pickup", "assigned-dispatch-officer-2"],
      },
    }).lean();

    let stats = {
      pending: 0,
      assigned: 0,
      urgent: 0,
    };

    const now = new Date();

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        // ✅ FIXED: Status check
        if (order.status === "ready-to-pickup") {
          stats.pending++;

          // Check if urgent (delivery within 4 hours)
          const deliveryTime = new Date(order.deliveryDate || now);
          const hoursUntilDelivery = (deliveryTime - now) / (1000 * 60 * 60);
          if (hoursUntilDelivery <= 4) {
            stats.urgent++;
          }
        } else if (order.status === "assigned-dispatch-officer-2") {
          stats.assigned++;
        }
      }
    }

    res.json(stats);
  } catch (error) {
    console.error("Error fetching assignment stats:", error);
    res.status(500).json({ error: "Failed to fetch assignment stats" });
  }
});

// Bulk assign multiple orders
router.post("/bulk-assign", async (req, res) => {
  try {
    const { assignments, employeeId, employeeName } = req.body;

    if (
      !assignments ||
      !Array.isArray(assignments) ||
      assignments.length === 0
    ) {
      return res.status(400).json({ error: "No assignments provided" });
    }

    const results = [];

    for (let assignment of assignments) {
      try {
        const { orderId, vehicleId, driverDetails, notes } = assignment;

        // Use the individual assign logic
        const assignResult = await assignSingleOrder(
          orderId,
          vehicleId,
          driverDetails,
          notes,
          employeeId,
          employeeName
        );

        results.push({
          orderId: orderId,
          success: true,
          result: assignResult,
        });
      } catch (error) {
        results.push({
          orderId: assignment.orderId,
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    res.json({
      success: true,
      message: `${successCount} out of ${assignments.length} orders assigned successfully`,
      results: results,
    });
  } catch (error) {
    console.error("Error in bulk assignment:", error);
    res.status(500).json({ error: "Failed to process bulk assignment" });
  }
});

// Helper function for single assignment (used by bulk assign)
async function assignSingleOrder(
  orderId,
  vehicleId,
  driverDetails,
  notes,
  employeeId,
  employeeName
) {
  // Find the order
  const customer = await Customer.findOne({
    "shoppingHistory.orderId": orderId,
  });

  if (!customer) {
    throw new Error("Order not found");
  }

  const orderIndex = customer.shoppingHistory.findIndex(
    (o) => o.orderId === orderId
  );
  const order = customer.shoppingHistory[orderIndex];

  // Get vehicle details
  const vehicle = await VehicleType.findById(vehicleId);
  if (!vehicle) {
    throw new Error("Vehicle not found");
  }

  // Update order with assignment details
  const assignmentData = {
    assignedVehicle: {
      vehicleId: vehicleId,
      vehicleName: vehicle.name,
      displayName: vehicle.displayName,
      category: vehicle.category,
      specifications: vehicle.specifications,
    },
    assignedDriver: driverDetails,
    assignedAt: new Date(),
    assignedBy: {
      employeeId: employeeId,
      employeeName: employeeName,
    },
    notes: notes || "",
  };

  // Update customer order
  customer.shoppingHistory[orderIndex].assignmentDetails = assignmentData;
  customer.shoppingHistory[orderIndex].status = "assigned-dispatch-officer-2";
  customer.shoppingHistory[orderIndex].driver1 = driverDetails.employeeName;

  await customer.save();

  // ✅ Update Employee record
  await Employee.findOneAndUpdate(
    { employeeId: driverDetails.employeeId },
    {
      $inc: { currentAssignments: 1 },
      "availability.lastStatusUpdate": new Date(),
    }
  );

  // Update delivery tracking workflow
  const tracking = await DeliveryTracking.findOne({ orderId: orderId });
  if (tracking) {
    tracking.workflowStatus.assigned.completed = true;
    tracking.workflowStatus.assigned.completedAt = new Date();
    tracking.workflowStatus.assigned.assignedDriver = driverDetails;
    tracking.workflowStatus.assigned.assignedBy = {
      employeeId: employeeId,
      employeeName: employeeName,
    };

    tracking.currentStatus = "assigned-dispatch-officer-2";
    await tracking.save();
  }

  return assignmentData;
}

// ✅ DEBUG: Check all employees with dispatch-officer-2 role
router.get("/debug/check-officers", async (req, res) => {
  try {
    console.log("=== DEBUG: Checking all employees ===");

    // Get ALL employees first
    const allEmployees = await Employee.find({}).select(
      "employeeId name roles isActivated isBlocked availability currentAssignments maxAssignments"
    );

    console.log("Total employees in DB:", allEmployees.length);

    // Check dispatch officers
    const dispatchOfficers = await Employee.find({
      roles: { $in: ["dispatch-officer-2"] },
    }).select(
      "employeeId name roles isActivated isBlocked availability currentAssignments"
    );

    console.log("Dispatch Officer 2 count:", dispatchOfficers.length);
    console.log(
      "Details:",
      dispatchOfficers.map((e) => ({
        id: e.employeeId,
        name: e.name,
        roles: e.roles,
        activated: e.isActivated,
        blocked: e.isBlocked,
        status: e.availability?.status,
        assignments: `${e.currentAssignments}/${e.maxAssignments}`,
      }))
    );

    res.json({
      totalEmployees: allEmployees.length,
      dispatchOfficers2Count: dispatchOfficers.length,
      dispatchOfficers2: dispatchOfficers,
      allEmployees: allEmployees.slice(0, 10), // First 10
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
