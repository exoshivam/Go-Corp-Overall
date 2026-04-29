import { RideRequest } from "./ride.model.js";
import { getDistance } from "../../utils/geo.js";

export const isPastTime = (scheduledAt) => {
  const date = new Date(scheduledAt);
  const now = Date.now();
  
  // Strict 1-minute buffer for clock drift/network latency
  return date.getTime() < (now - 1 * 60 * 1000);
};

export const isWithinOfficeHours = (scheduledAt, office) => {
  const date = new Date(scheduledAt);

  const scheduledDay = date.getDay();

  if (!office.working_days.includes(scheduledDay)) {
    console.log("Ride is not within office hours");
    return false;
  }

  const scheduledMinutes =
    date.getHours() * 60 + date.getMinutes();

  const [startH, startM] = (office.shift_start || "00:00").split(":").map(Number);
  const [endH, endM] = (office.shift_end || "23:59").split(":").map(Number);

  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  return scheduledMinutes >= start && scheduledMinutes <= end;
};

export const isDuplicateBooking = async (employeeId, scheduledAt) => {
  const scheduled_at = new Date(scheduledAt);
  const start = new Date(scheduled_at.getTime() - 10 * 60 * 1000);
  const end = new Date(scheduled_at.getTime() + 10 * 60 * 1000);

  const ride = await RideRequest.findOne({
    employee_id: employeeId,
    scheduled_at: { $gte: start, $lte: end },
    status: { $ne: "CANCELLED" }
  });

  if (ride) return true
  else return false
};

export const isOneEndOffice = (pickupLocation, dropLocation, officeLocation) => {
  // Handle both array [lng, lat] and GeoJSON {coordinates: [lng, lat]} formats
  const pickup = Array.isArray(pickupLocation) ? pickupLocation : pickupLocation.coordinates;
  const drop = Array.isArray(dropLocation) ? dropLocation : dropLocation.coordinates;
  const office = Array.isArray(officeLocation) ? officeLocation : officeLocation.coordinates;

  return (
    getDistance(pickup, office) < 200 ||
    getDistance(drop, office) < 200
  );
};

//validate the invited employees
export const validateInvitedEmployees = (invitedEmployeeIds) => {
  // Validate that invited_employee_ids is an array
  if (!Array.isArray(invitedEmployeeIds)) {
    return { valid: false, message: "invited_employee_ids must be an array" };
  }

  // Validate max 3 invited employees
  if (invitedEmployeeIds.length > 3) {
    return { valid: false, message: "Maximum 3 people can be invited (4 total including requester)" };
  }

  // Validate all are valid MongoDB ObjectIds
  for (let id of invitedEmployeeIds) {
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return { valid: false, message: `Invalid employee ID format: ${id}` };
    }
  }

  return { valid: true };
};

export const getInvitedPeopleForRide = async (employeeId) => {
  try {
    const ride = await RideRequest.findOne({ 
      employee_id: employeeId,
      status: { $ne: "CANCELLED" }
    }).populate('invited_employee_ids', '_id name email phone_number');

    if (!ride) {
      return { total: 1, people: [{ _id: employeeId, type: "requester" }] };
    }

    const people = [
      { _id: ride.employee_id, type: "requester" },
      ...ride.invited_employee_ids.map(emp => ({ ...emp.toObject(), type: "invited" }))
    ];

    return {
      total: people.length,
      people: people.slice(0, 4) // Ensure max 4
    };
  } catch (error) {
    throw error;
  }
};

// For clustering service: Find all rides with a specific invited employee
export const findRidesInvitingEmployee = async (employeeId, scheduledAt) => {
  try {
    // Find all rides where this employee was invited within a time window
    const timeWindow = 15 * 60 * 1000; // 15 mins window
    const start = new Date(new Date(scheduledAt).getTime() - timeWindow);
    const end = new Date(new Date(scheduledAt).getTime() + timeWindow);

    const rides = await RideRequest.find({
      invited_employee_ids: employeeId,
      scheduled_at: { $gte: start, $lte: end },
      status: { $in: ["PENDING", "IN_CLUSTERING", "CLUSTERED"] }
    }).populate('employee_id', '_id name email');

    return rides;
  } catch (error) {
    throw error;
  }
};

// For clustering service: Get all employees to cluster (requester + invited)
export const getEmployeesInRideGroup = async (rideId) => {
  try {
    const ride = await RideRequest.findById(rideId).populate('invited_employee_ids', '_id');
    
    if (!ride) return [];

    // Return array of all employee IDs: requester + invited
    const allEmployees = [ride.employee_id, ...ride.invited_employee_ids.map(e => e._id)];
    return allEmployees;
  } catch (error) {
    throw error;
  }
};

/**
 * Calculate total number of people across multiple RideRequests
 * (Requesters + All Invited Guests)
 */
export const getTotalPeopleInRides = async (rideIds) => {
  try {
    const rides = await RideRequest.find({ _id: { $in: rideIds } });
    let total = 0;
    rides.forEach(ride => {
      // 1 (Requester) + N (Invited)
      total += 1 + (ride.invited_employee_ids?.length || 0);
    });
    return total;
  } catch (error) {
    console.error("Error calculating total people in rides:", error);
    return rideIds.length; // Fallback to booking count if error
  }
};