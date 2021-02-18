'use strict';
/*
Bottom up:
RoomObjects are either a target or targeter
A targeter will interact with a target specified
by a task.
A targeter can fail to interact with a target.
A reason a targeter can fail it's interaction
is that it is too far away from (ERR_NOT_IN_RANGE)
it's target.
If a targeter is to far away it will find a path
to it.
A task is assigned based on a targeter's role.
Targeters are created and assigned roles until
a certain number has been reached.

Top down:
Rooms contain RoomObjects.
Creeps and Turrets are RoomObjects.
Tasks are assigned to RoomObjects based
on a predetermined role.
A RoomObject will try to complete a task but can fail
to complete it due to a variety of reasons.
One of the reasons a task can fail is that a RoomObject
is to far away from it's target.
If this is the case the RoomObject finds a path to it's target.
*/

/*
TABLE OF CONTENTS
Section 0: Imports
Section 1: Constants
Section 1.1: Tasks
Section 2: Role class
Section 2.1: roleEnergyHarvester
Section 2.2: roleShortRangedDefender
Section 2.3: roleMechanic
Section 3: Main Loop
Section 3.1: Creep Updater Function(s)
Section 3.2: Tower Updater Function(s)
Section 4: Prototype overloads
Section 4.1: RoomObject target and targeters implementation
Section 4.2: RoomObject task and role Implementations
Section 5: Memory Implementations
Section 6: Utility Functions
*/

/*
Section 0: Imports
*/

var _ = require('lodash');

/*
Section 1: Constants
*/
const MEMORY_CLEANUP_INTERVAL = 10;
const ROOM_WIDTH = 50;
const ROOM_HEIGHT = 50;
const IDLE_FLAG = 'idle_flag';
const MAX_TOWER_DISTANCE = 10;

/*
Section 1.1: Tasks
*/

const TASK_IDLE = 'task_idle';
const TASK_HARVEST_SOURCE = 'task_harvest_source';
const TASK_DELIVER_ENERGY = 'task_deliver_energy';
const TASK_BUILD_STRUCTURE = 'task_build_structure';
const TASK_COLLECT_ENERGY = 'task_collect_energy';
const TASK_WAIT_AT_POS = 'task_wait_at_pos';
const TASK_WAIT_FOR_INTERACTION = 'task_wait_for_interaction';
const TASK_RENEW = 'task_renew';
const TASK_ATTACK_ENEMY = 'task_attack_enemy';
const TASK_UPGRADE_CONTROLLER = 'task_upgrade_controller';
const TASK_HEAL_TARGET = 'task_heal_target';

class Task {
  constructor(taskName, target) {
    this.taskName = taskName;
    this.target = target;
  }

}

/*
Section 2: Role class
*/
class Role {
  constructor(roleName) {
    this.roleName = roleName;
    if(Role.roles == null) {
      Role.roles = {};
    }
    Role.roles[roleName] = this;
  }
  getObjectsWithRole() {
    let roleName = this.roleName;
    return _.filter(Game.creeps, function(creep) {
      return creep.getRole().roleName === roleName;
    });
  }
  getNewCreepName() {
    let creeps = this.getObjectsWithRole();
    if(creeps.length === 0) {
      return this.roleName + 1;
    }
    let nums = [];
    //get a sorted list of the numbers appended to each name
    for(let i = 0; i < creeps.length; i++) {
      let creep = creeps[i];
      let num = parseInt(creep.name.substr(this.roleName.length));
      let j = nums.length;
      nums.push(num);
      while((nums[j] < nums[j - 1]) && (j > 0)) {
        let temp = nums[j];
        nums[j] = nums[j - 1];
        nums[j - 1] = temp;
        j--;
      }
    }
    let prev = 0;
    //find the first spot where there is a gap
    for(let i = 0; i < nums.length; i++) {
      if(nums[i] != prev + 1){
        break;
      }
      prev++;
    }
    //append this gap or one more than the total number to the rolename
    return this.roleName + (prev + 1);
  }
  getBodies() {
    return [[WORK, CARRY, MOVE]];
  }
  getBestBody(room) {
    let bodies = this.getBodies();
    let maxEnergy = room.energyCapacityAvailable;
    if(bodies.length === 0) {
      return [];
    }
    let bestBody = bodies[0];
    let bestBodyCost = getBodyCost(bestBody);
    for(let i = 0; i < bodies.length; i++) {
      let body = bodies[i];
      let cost = getBodyCost(body);
      if((cost <= maxEnergy) && (cost > bestBodyCost)) {
        bestBody = body;
        bestBodyCost = cost;
      }
    }
    return bestBody;
  }

  hasBestBody(creep) {
    let bestBody = this.getBestBody(creep.room);
    return getBodyCost(bestBody) <= getBodyCost(creep.body);
  }

  shouldRenew(creep) {
    return creep.shouldRenew() && this.hasBestBody(creep);
  }
  spawnCreep(spawner, body = null, dryRun = false) {
    if(spawner == null) {
      return ERR_INVALID_ARGS;
    }

    if(body == null) {
      body = this.getBestBody(spawner.room);
    }
    return spawner.spawnCreep(body, this.getNewCreepName(), {
      memory: {
        roleName: this.roleName
      }
    });
  }
  getNewTask(creep) {
    return new Task(TASK_IDLE, null);
  }
  processTask(creep) {
    let taskName = creep.getTask().taskName;

    let target = creep.getTarget();
    //value this function will return
    let taskFinished = false;
    //value for general processing at end
    let returnCode = OK;
    //whether to do general processing at end
    let handleReturnCode = true;

    switch(taskName) {
      case TASK_IDLE:
      let idle_spot = creep.room.controller;
      let idle_flags = creep.room.find(FIND_FLAGS, {
        filter: function(flag) {
          return flag.name === IDLE_FLAG;
        }
      });
      if(idle_flags.length > 0) {
        idle_spot = idle_flags[0];
      }
      switch(creep.moveTo(idle_spot)) {
        case ERR_NO_BODYPART: break;
      }
      return true;

      case TASK_HARVEST_SOURCE:
      if((target == null) || creep.store.isFull(RESOURCE_ENERGY)) {
        return true;
      }
      returnCode = creep.harvest(target);
      break; //END TASK_HARVEST_SOURCE
      case TASK_DELIVER_ENERGY:
      if(creep.store.isEmpty(RESOURCE_ENERGY) || (target == null)) {
        return true;
      }
      if((target instanceof Structure) && target.isType(STRUCTURE_CONTROLLER)) {
        returnCode = creep.upgradeController(target);
      } else {
        returnCode = creep.transfer(target, RESOURCE_ENERGY);
      }
      switch(returnCode) {
        case ERR_FULL: return true;
      }
      break; //END TASK_DELIVER_ENERGY

      case TASK_BUILD_STRUCTURE:
      if(creep.store.isEmpty(RESOURCE_ENERGY) || (target == null) || (target.structureType == null)) {
        return true;
      }
      if(target instanceof ConstructionSite) {
        returnCode = creep.build(target);
      } else if(target instanceof Structure) {
        if(target.hits === target.hitsMax) {
          return true;
        }
        returnCode = creep.repair(target);
      }
      switch(returnCode) {
        case ERR_NOT_ENOUGH_RESOURCES:  return true;
        case ERR_INVALID_TARGET: return true;
      }
      break; //END TASK_BUILD_STRUCTURE
      case TASK_COLLECT_ENERGY:
      if((target == null) || creep.store.isFull(RESOURCE_ENERGY)) {
        return true;
      }
      if(target instanceof Resource) {
        if(target.resourceType === RESOURCE_ENERGY) {
          returnCode = creep.pickup(target);
        } else {
          return true;
        }
      }
      else if(target.isType(STRUCTURE_STORAGE) || target.isType(STRUCTURE_CONTAINER)) {
        returnCode = creep.withdraw(target, RESOURCE_ENERGY);
      } else {
        return true;
      }
      break; //END TASK_COLLECT_ENERGY

      case TASK_RENEW:
      if(target == null || !(target instanceof StructureSpawn)) {
        return true;
      }
      returnCode = target.renewCreep(creep);
      switch(returnCode) {
        case ERR_FULL: return true;
        case ERR_NOT_ENOUGH_RESOURCES: return true;
      }
      break; // END TASK_RENEW
      case TASK_ATTACK_ENEMY:
      if(target == null) {
        return true;
      }
      returnCode = creep.attack(target);
      break; // END TASK_ATTACK_ENEMY
      case TASK_UPGRADE_CONTROLLER:
      returnCode = creep.upgradeController(target);
      switch(returnCode) {
        case ERR_INVALID_TARGET: return true;
        case ERR_FULL: return true;
        case ERR_NOT_ENOUGH_RESOURCES:  return true;
      }
      break; //END TASK_UPGRADE_CONTROLLER

    }

    if(handleReturnCode) {
      switch(returnCode) {
        case ERR_NOT_OWNER: console.log('attempted to control unowned creep: ' + this.name + ' at: ' + this.pos); break;
        case ERR_NOT_IN_RANGE: creep.moveTo(target); break;
        case ERR_NO_BODYPART: console.log('creep: ' + this.name + ' at: ' + this.pos + ' is missing body part to process task: ' + taskName); break;
      }
    }
    return taskFinished;
  }
}
/*
Section 2.1: roleEnergyHarvester
*/
var roleEnergyHarvester = new Role('energy_harvester');
roleEnergyHarvester.getBodies = function() {
  return [
    [MOVE, WORK, CARRY],
    [MOVE, MOVE, WORK, CARRY],
    [MOVE, MOVE, MOVE, MOVE, WORK, WORK, WORK, CARRY]
  ];
}
roleEnergyHarvester.getNewTask = function(creep) {
  let idle = false;

  let controller = creep.room.controller;

  //has energy
  if(!creep.store.isEmpty(RESOURCE_ENERGY)){


    if(this.shouldRenew(creep)) {
      let closestSpawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
      return new Task(TASK_RENEW, closestSpawn);
    }

    if(!this.hasBestBody(creep)) {
      //TODO recycle
    }

    let oldTaskName = creep.getTask().taskName;
    //logic to give near-by creeps energy
    if(oldTaskName === TASK_HARVEST_SOURCE) {
      let targeters = creep.getTargeters();
      let waitingCreeps = _.filter(targeters, function(targeter) {
        return targeter.getTaskName() === TASK_WAIT_FOR_INTERACTION;
      });
      if(waitingCreeps.length > 0) {
        return new Task(TASK_DELIVER_ENERGY, waitingCreeps[0]);
      }
    }

    //prioritize keeping controller at level if overworked on other stuff
    if(controller.progress < 2000) {
      return new Task(TASK_UPGRADE_CONTROLLER, creep.room.controller);
    }

    //go dump energy at spawns/extensions
    let constructionSites = Object.values(Game.constructionSites);
    if(!creep.room.energyFull()) {

      let closestSite = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {
        filter: function(structure) {
          if((structure.isType(STRUCTURE_SPAWN)) ||
          (structure.isType(STRUCTURE_EXTENSION))) {
            return !structure.store.isFull(RESOURCE_ENERGY);
          } else {
            return false;
          }
        }
      });

      if(closestSite != null) {
        return new Task(TASK_DELIVER_ENERGY, closestSite)
      }

    }
    //go build
    else if(constructionSites.length > 0) {

      let closestSite = creep.pos.findClosestByRange(constructionSites, {
        filter: function(site) {
          if(site == null) {
            return false;
          }
          let energyOnTheWay = 0;
          let targeters = site.getTargeters();

          for(let targeter in targeters) {
            if(targeter.store == null) {
              continue;
            }
            energyOnTheWay += targeter.store.getUsedCapacity(RESOURCE_ENERGY);
          }
          return energyOnTheWay + site.progress < site.progressTotal;

        }
      });

      if(closestSite != null) {
        return new Task(TASK_BUILD_STRUCTURE, closestSite);
      }
      //go dump in storage then controller
    } else {
      let closestStore = tryGetClosestEnergyStore(creep.pos);
      if(closestStore != null) {
        return new Task(TASK_DELIVER_ENERGY, closestStore);
      } else {
        return new Task(TASK_UPGRADE_CONTROLLER, creep.room.controller);
      }
    }

    //go to source
  } else if(!creep.store.isFull(RESOURCE_ENERGY)){

    let sources = creep.room.find(FIND_SOURCES);
    let newTarget = null
    if(sources.length > 0) {
      newTarget = sources[0];
      for(let i = 0; i < sources.length; i++) {
        let source = sources[i];
        if(source.getTargeterCount() < newTarget.getTargeterCount()) {
          newTarget = source;
        }
      }
    }

    if(newTarget != null) {
      return new Task(TASK_HARVEST_SOURCE, newTarget);
    }
  }
  return new Task(TASK_IDLE, null);
}
/*
Section 2.2: roleShortRangedDefender
*/
var roleShortRangedDefender = new Role('short_ranged_defender');
roleShortRangedDefender.getBodies = function() {
  return [
    [MOVE, MOVE, ATTACK, ATTACK],
    [MOVE, MOVE, MOVE, ATTACK, ATTACK, TOUGH],
    [MOVE, MOVE, MOVE, MOVE, MOVE, ATTACK, ATTACK, ATTACK, TOUGH, TOUGH]
  ]
}
roleShortRangedDefender.getNewTask = function(creep) {

  if(creep.shouldRenew()) {
    let closestSpawn = creep.pos.findClosestByRange(FIND_MY_SPAWNS);
    if(closestSpawn != null) {
      return new Task(TASK_RENEW, closestSpawn);
    }

  } else if (!this.hasBestBody(creep)){
    //TODO recycle
  }

  let hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS, {
    filter: function(creep) {
      return creep.canAttack();
    }
  });

  if(hostileCreeps.length > 0) {
    let closestEnemy = creep.pos.findClosestByRange(hostileCreeps);
    return new Task(TASK_ATTACK_ENEMY, closestEnemy);
  }

  return new Task(TASK_IDLE, null);

}

/*
Section 2.3: roleMechanic
*/
var roleMechanic = new Role('mechanic');
roleMechanic.getBodies = function() {
  return [[WORK, CARRY, MOVE, MOVE]];
}
roleMechanic.getNewTask = function(creep) {
  let totalWallHits = 0;
  //get closest thing in room that needs repairs
  let walls = [];
  let energyStores = [];
  let damagedNonWallStructures = creep.room.getDamagedStructures(false, true);

  if(!creep.store.isEmpty(RESOURCE_ENERGY)) {

    //not roads and walls
    let newTarget = creep.pos.findClosestByRange(creep.room.getDamagedStructures(false, false));

    //roads only
    if(newTarget == null) {
      newTarget = creep.pos.findClosestByRange(creep.room.getDamagedStructures(false, true));
    }

    //walls only
    if(newTarget == null) {
      let walls = creep.room.getDamagedStructures(true, false);
      let totalHits = 0;
      walls.forEach(function(wall) {
        totalHits += wall.hits;
      });
      let averageHits = totalHits / walls.length;
      newTarget = creep.pos.findClosestByRange(walls, {
        filter: function(wall) {
          return wall.hits <= averageHits;
        }
      });
    }

    if(newTarget == null) {
      return new Task(TASK_IDLE, null);
    } else {
      return new Task(TASK_BUILD_STRUCTURE, newTarget);
    }

  } else {

    let stores = _.filter(creep.room.getStoresWithResource(RESOURCE_ENERGY), function(structure) {
      return structure.isType(STRUCTURE_CONTAINER) || structure.isType(STRUCTURE_STORAGE);
    });
    let newTarget = creep.pos.findClosestByRange(stores);

    if(newTarget != null) {
      return new Task(TASK_COLLECT_ENERGY, newTarget);
    }


  }
  return new Task(TASK_IDLE, null);
}


var roleEnergyHauler = new Role('energy_hauler');

roleEnergyHauler.getNewTask = function(creep) {
  //if energy store empty go grab energy from dropped resources or
  //container/storage designated to be emptied
  let master = creep.room.getMaster();
  let masterBuffers = master.getBuffersWithResource(RESOURCE_ENERGY);
  let slaves = master.getSlaves();
  let slavesBuffers = [];
  slaves.forEach(function(room) {
    slavesBuffers = slavesBuffers.concat(room.getStoresWithResource(RESOURCE_ENERGY));
  });

  if(creep.store.isEmpty(RESOURCE_ENERGY)) {
  }


  //if energy store full go drop off at storage


  return new Task(TASK_IDLE, null);
}

class TowerRole extends Role {

  processTask(tower) {
    let task = tower.getTask();

    let returnCode = OK;
    switch(task.taskName) {
      case TASK_ATTACK_ENEMY:
        returnCode = tower.attack(task.target);
      break; //END TASK_ATTACK_ENEMY

      case TASK_BUILD_STRUCTURE:
        returnCode = tower.repair(task.target);
      break; //END TASK_BUILD_STRUCTURE

      case TASK_HEAL_TARGET:
        returnCode = tower.heal(task.target);
      break;
    }

    switch(returnCode) {
      default: return true;
    }
  }

}

var roleGenericTower = new TowerRole('generic_tower');
roleGenericTower.getNewTask = function(tower) {

  let hostileCreeps = tower.room.find(FIND_HOSTILE_CREEPS);
  let newTarget = tower.pos.findClosestByRange(hostileCreeps);
  if(newTarget.pos.getRangeTo(tower) > MAX_TOWER_DISTANCE) {
    return new Task(TASK_ATTACK_ENEMY, newTarget);
  }


  return new Task(TASK_IDLE, null);

}


/*
Section 3.0: Main Loop
*/
module.exports.loop = function() {
  //initialize null fields in memory
  if(Memory.creeps == null) {
    Memory.creeps = {}
  }
  if(Memory.constructionSites == null) {
    Memory.constructionSites = {}
  }
  if(Memory.resources == null) {
    Memory.resources = {}
  }
  if(Memory.structures == null) {
    Memory.structures = {}
  }
  if(Memory.spawns == null) {
    Memory.spawns = {}
  }
  if(Memory.towers == null) {
    Memory.towers = {}
  }
  //clean up memory
  if(Game.time % MEMORY_CLEANUP_INTERVAL == 0) {
    Object.keys(Memory.constructionSites).forEach(function(siteId) {
      let site = Game.getObjectById(siteId);
      if(site == null) {
        delete Memory.constructionSites[siteId];
      } else {
        site.initialize();
      }
    });
    Object.keys(Memory.resources).forEach(function(resourceId) {
      let resource = Game.getObjectById(resourceId);
      if(resource == null) {
        delete Memory.resources[resourceId];
      } else {
        resource.initialize();
      }
    });
    Object.keys(Memory.structures).forEach(function(structureId) {
      let structure = Game.getObjectById(structureId);
      if(structure == null) {
        delete Memory.structures[structureId];
      } else {
        structure.initialize();
      }
    });
    Object.keys(Memory.spawns).forEach(function(structureId) {
      let spawn = Game.spawns[structureId];
      if(spawn == null) {
        spawn = Game.getObjectById(structureId);
      }
      if(spawn == null) {
        delete Memory.spawns[structureId];
      } else {
        spawn.initialize();
      }
    });

  }
  //update creeps
  Object.keys(Memory.creeps).forEach(function(creepName) {
    let creep = Game.creeps[creepName];
    if(creep == null) {
      creep = Game.getObjectById(creepName);
    }
    if(creep == null) {
      delete Memory.creeps[creepName];
      return;
    }
    if(creep.my) {
      creep.update();
    }
  });

  //update towers
  Object.keys(Memory.towers).forEach(function(structureId) {
    let tower = Game.getObjectById(structureId);
    if(tower == null) {
      delete Memory.towers[structureId];
      return;
    }
    if(tower.my) {
      tower.update();
    }
  });

  //spawn more creeps
  //TODO update harvesters on a per room basis
  let spawner = Game.spawns['Spawn1'];
  let desiredHarvesters = 0;

  let emptySourceSpots = 0;
  let sources = spawner.room.find(FIND_SOURCES, {
    filter: function(source) {
      emptySourceSpots += source.getNonWallCountInRange(1);
      return true;
    }
  });
  if(spawner.room.energyCapacityAvailable === 300) {
    desiredHarvesters = emptySourceSpots;
  } else {
    desiredHarvesters = Math.min(sources.length * 2, emptySourceSpots);
  }
  if(roleEnergyHarvester.getObjectsWithRole().length < desiredHarvesters) {
    roleEnergyHarvester.spawnCreep(spawner);
  }

  let mechanics = roleMechanic.getObjectsWithRole();

  if(mechanics.length < 1) {
    roleMechanic.spawnCreep(spawner);
  }

  let shortRangedDefenders = roleShortRangedDefender.getObjectsWithRole();
  if(shortRangedDefenders.length < 1) {
    roleShortRangedDefender.spawnCreep(spawner);
  }
}
/*
Section 4: Prototype Overloads
*/
Creep.prototype.canAttack = function() {
  for(let i = 0; i < this.body.length; i++) {
    let part = this.body[i];
    let partType = part.type;
    if(partType == null){
      continue;
    }
    if((partType === ATTACK) ||
    (partType === RANGED_ATTACK) ||
    (partType === CLAIM)) {
      return true;
    }
  }
  return false;
}
Creep.prototype.getRenewTicks = function() {
  return Math.floor(600 / this.body.length);
}
Creep.prototype.shouldRenew = function(ticksThreshold = 500) {
  return this.ticksToLive < ticksThreshold;
}

Room.prototype.getMaster = function() {
  if(this.memory.master == null) {
    return null;
  }
  let master = Game.rooms[this.memory.master];
  return master;
}

Room.prototype.setMaster = function(room) {
  if(room == null) {
    return false;
  }
  if(this.memory.master != null) {
    let master = Game.rooms[this.memory.master];
    if(master != null) {
      if(!master.removeSlave(this)) {
        return false;
      }
    }
  }
  if(this.memory.slaves != null) {
    for(let i = 0; i < this.memory.slaves.length; i++) {
      let slave = Game.rooms[this.memory.slaves[i]];
      if(slave != null) {
        room.addSlave(slave);
      }
    }
  }
  this.memory.master = room.name;
  return true;
}

Room.prototype.getSlaves = function() {
  if(this.memory.slaves == null) {
    return [];
  }
  let slaves = [];
  this.memory.slaves.forEach(function(roomName) {
    let room = Game.rooms[roomName];
    if(room != null) {
      slaves.push(Game.rooms[roomName]);
    }
  });
  return slaves;
}

Room.prototype.addSlave = function(room) {
  if(this.memory.slaves == null || room == null) {
    this.memory.slaves = [];
  }
  for(let i = 0; i < this.memory.slaves.length; i++) {
    let slaveName = this.memory.slaves[i];
    if(slaveName === room.name) {
      return false;
    }
  }
  this.memory.slaves.push(room.name);
  return true;
}

Room.prototype.removeSlave = function(room) {
  if(this.memory.slaves == null || room == null) {
    return false;
  }
  let index = this.memory.slaves.indexOf(room.name);
  if(index === -1) {
    return false;
  }
  this.memory.slaves.splice(index, 1);
  return true;
}

Room.prototype.energyFull = function() {
  return this.energyAvailable === this.energyCapacityAvailable;
}
Room.prototype.energyEmpty = function() {
  return this.energyAvailable === 0;
}
Room.prototype.getSources = function(callback = null) {
  return this.find(FIND_SOURCES, {filter: callback});
}
Room.prototype.getDeposits = function(callback = null) {
  return this.find(FIND_DEPOSITS, {filter: callback});
}
Room.prototype.getMinerals = function(callback = null) {
  return this.find(FIND_MINERALS, {filter: callback});
}
Room.prototype.getDroppedResources = function() {
  return this.find(FIND_DROPPED_RESOURCES);
}
Room.prototype.getSpawns = function(includeEnemySpawns = false) {
  let result = this.find(FIND_MY_SPAWNS);
  if(includeEnemySpawns) {
    result = result.concat(this.find(FIND_ENEMY_SPAWNS));
  }
  return result;

}
Room.prototype.getConstructionSites = function(includeEnemySites = false) {
  if(includeEnemySites) {
    return this.find(FIND_CONSTRUCTION_SITES);
  } else {
    return this.find(FIND_MY_CONSTRUCTION_SITES);
  }
}
Room.prototype.initializeStructures = function() {
  if(this.structuresInitialized) {
    return;
  }
  if(this.structuresWithStore == null) {
    this.structuresWithStore = [];
  }

  if(this.damagedWalls == null) {
    this.damagedWalls = [];
  }
  if(this.damagedRoads == null) {

    this.damagedRoads = [];
  }
  if(this.damagedStructures == null) {
    this.damagedStructures = [];
  }
  let room = this;

  this.find(FIND_STRUCTURES, {
    filter: function(structure) {
      if(structure.store != null) {
        room.structuresWithStore.push(structure)
      }
      if(structure.hits < structure.hitsMax) {
        if(structure.isType(STRUCTURE_WALL) || structure.isType(STRUCTURE_RAMPART)) {
          room.damagedWalls.push(structure);
        } else if(structure.isType(STRUCTURE_ROAD)) {
          room.damagedRoads.push(structure);
        } else {
          room.damagedStructures.push(structure);
        }
      }
    }
  });


  this.structuresInitialized = true;
}
Room.prototype.getBuffersWithResource = function(resourceType) {
  if(!this.structuresInitialized){
    this.initializeStructures();
  }
  let buffers = _.filter(this.structuresWithStore, function(structure) {
    return (structure.isType(STRUCTURE_CONTAINER) || structure.isType(STRUCTURE_STORAGE)) && !structure.store.isEmpty(resourceType);
  });
  return buffers;
}
Room.prototype.getDamagedStructures = function(includeWalls = false, includeRoads = false) {
  if(!this.structuresInitialized){
    this.initializeStructures();
  }
  let result = this.damagedStructures;
  if(includeWalls) {
    result = result.concat(this.damagedWalls);
  }
  if(includeRoads) {
    result = result.concat(this.damagedRoads);
  }
  return result;
}
Room.prototype.getStoresWithResource = function(resourceType) {
  if(!this.structuresInitialized){
    this.initializeStructures();
  }
  return _.filter(this.structuresWithStore, function(structure) {
    return !structure.store.isEmpty(resourceType);
  });
}


RoomObject.prototype.getNonWallCountInRange = function(range) {
  if(this.nonWallCountInRange != null) {
    return this.nonWallCountInRange;
  }
  if(range < 1) {
    return 0;
  }
  let total = 0;
  let terrain = this.room.getTerrain();
  this.pos.forEachPosInRange(range, function(pos) {
    if(terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
      total++;
    } else {
      let look = pos.look();
      look.forEach(function(lookObject) {
        if((lookObject.type === LOOK_STRUCTURES) && (lookObject[LOOK_STRUCTURES] === STRUCTURE_ROAD)) {
          total++;
        }
      });
    }
  });

  this.nonWallCountInRange = total;
  return this.nonWallCountInRange;
}
RoomObject.prototype.getCreepsInRange = function(range, includeSelf = false) {
  if(this.creepsInRange != null) {
    return this.creepsInRange;
  }
  if(range < 1) {
    return [];
  }

  let creeps = [];

  this.pos.forEachPosInRange(range, function(pos) {
    creeps = creeps.concat(pos.lookFor(LOOK_CREEPS));
  });

  this.creepsInRange = creeps;
  return this.creepsInRange;
}

RoomPosition.prototype.forEachPosInRange = function(range, callback) {

  if(range < 0) {
    return;
  }

  if(range === 0) {
    callback(this);
  }

  for(let x = (this.x - range); x <= (this.x + range); x++) {
    for(let y = (this.y - range); y <= (this.y + range); y++) {

      if((x < 0) || (x >= ROOM_WIDTH) || (y < 0) || (y >= ROOM_HEIGHT)) {
        continue;
      }
      if((x === this.x) && (y === this.y)){
        callback(this);
      } else {
        callback(new RoomPosition(x, y, this.roomName));
      }

    }
  }
}

Structure.prototype.isType = function(structureType) {
  return this.structureType === structureType;
}

Store.prototype.isFull = function(resourceType) {
  return this.getFreeCapacity(resourceType) === 0;
}
Store.prototype.isEmpty = function(resourceType) {
  return this.getUsedCapacity(resourceType) === 0;
}
/*
Section 4.1: RoomObject target and targeters implementation
*/

RoomObject.prototype.initialize = function() {
  if(this.initialized == null) {
    this.initialized = false;
  }

  if(this.initialized) {
    return;
  }

  if((this.memory == null) || (this.id == null)) {
    if(this.id == null) {
      console.log('No id for RoomObject at: ' + this.pos );
    } else {
      console.log('memory not implemented for RoomObject at: ' + this.pos);
    }
    this.initialized = true;
    this.target = null;
    this.targeterCount = 0;
    this.targeters = [];
    return;
  }

  //add targeters array if null
  if(this.memory.targeterIds == null) {
    this.memory.targeterIds = [];
  }
  //remove duplicate and invalid targeters
  let targetersMap = {}
  for(let i = 0; i < this.memory.targeterIds.length; i++) {
    let targeterId = this.memory.targeterIds[i];
    let targeter = Game.getObjectById(targeterId);
    if((targeter == null) ||
    (targetersMap[targeterId] != null) ||
    targeter.memory.targetId !== this.id) {
      continue;
    }

    targetersMap[targeterId] = targeter;
  }
  //set up targeters cache
  this.memory.targeterIds = Object.keys(targetersMap);
  this.targeters = Object.values(targetersMap);
  this.targeterCount = this.targeters.length;

  //clear target if invalid and set up target cache
  let target = Game.getObjectById(this.memory.targetId);
  if(target == null) {
    delete this.memory.targetId;
  } else {
    this.target = target
  }

  this.initialized = true;

}
RoomObject.prototype.getTargeterCount = function() {
  if(!this.initialized) {
    this.initialize();
  }
  return this.targeterCount;
}
RoomObject.prototype.getTargeters = function() {
  if(!this.initialized) {
    this.initialize();
  }
  return this.targeters;
}
RoomObject.prototype.addTargeter = function(targeter, setTarget = true) {
  if((targeter == null) || (targeter.id == null)) {
    return false;
  }

  if(!this.initialized) {
    this.initialize();
  }

  if(setTarget) {
    if(!targeter.setTarget(this, false)) {
      return false;
    }
  }

  this.memory.targeterIds.push(targeter.id);

  if(this.targeterCount != null) {
    this.targeterCount++;
  } else {
    this.targeterCount = this.memory.targeterIds.length;
  }
  return true;

}
RoomObject.prototype.removeTargeter = function(targeter, clearTarget = true) {
  if((targeter == null) || (targeter.id == null)) {
    return false;
  }

  if(!this.initialized) {
    this.initialize();
  }

  let index = this.memory.targeterIds.findIndex((id) => id === targeter.id);

  if(index === -1) {
    return false;
  }

  if(clearTarget) {
    if(!targeter.clearTarget(false)) {
      return false;
    }
  }
  this.memory.targeterIds.splice(index, 1);
  return true;

}
RoomObject.prototype.hasTargeter = function(targeter) {
  if((targeter == null) || (targeter.id == null)) {
    return false;
  }

  if(!this.initialized) {
    this.initialize();
  }

  let index = this.memory.targeterIds.findIndex((id) => id === targeter.id);
  return index !== -1;
}
RoomObject.prototype.getTarget = function() {
  if(!this.initialized) {
    this.initialize();
  }

  return this.target;
}
RoomObject.prototype.setTarget = function(target, addTargeter = true) {
  if((target == null) || (target.id == null)) {
    return false;
  }

  if(!this.initialized) {
    this.initialize();
  }

  let oldTarget = this.getTarget();

  if(oldTarget != null) {
    oldTarget.removeTargeter(this, false);
  }

  if(addTargeter) {
    if(!target.addTargeter(this, false)) {
      return false;
    }
  }
  this.target = target;
  this.memory.targetId = target.id;
  return true;
}
RoomObject.prototype.clearTarget = function(removeTargeter = true) {
  if(this.memory == null) {
    return false;
  }

  if(removeTargeter) {
    let target = this.getTarget();
    if((target == null) || !target.removeTargeter(this, false)){
      return false;
    }
  }
  delete this.target;
  delete this.memory.targetId;
}
RoomObject.prototype.isTarget = function(other) {
  if((other == null) || (this.memory == null) || (other.id == null) || (this.memory.targetid == null)) {
    return false;
  }

  return this.memory.targetId === other.id;
}
/*
Section 4.2: RoomObject task and role Implementations
*/
RoomObject.prototype.getRole = function() {
  if(!this.initialized) {
    this.initialize()
  }
  return Role.roles[this.memory.roleName];
}
RoomObject.prototype.setRole = function(newRole) {
  if(newRole == null) {
    return false;
  }
  if(!this.initialized) {
    this.initialize();
  }
  this.memory.roleName = newRole.getRoleName();
  return true;
}
RoomObject.prototype.hasTask = function() {
  if(!this.initialized) {
    this.initialize();
  }
  return this.memory.taskName != null;
}
RoomObject.prototype.getTask = function() {
  if(!this.initialized) {
    this.initialize();
  }
  return new Task(this.memory.taskName, this.getTarget());
}
RoomObject.prototype.setTask = function(newTask) {
  if(newTask == null) {
    return false;
  }
  if(!this.initialized) {
    this.initialize();
  }
  this.memory.taskName = newTask.taskName;
  this.setTarget(newTask.target);
  return true;
}
RoomObject.prototype.clearTask = function() {
  if(!this.initialized) {
    this.initialize();
  }
  delete this.memory.taskName;

}
/*
Section 4.3: RoomObject update
*/
RoomObject.prototype.update = function() {
  if(!this.hasTask()) {
    let newTask = this.getNewTask();
    if(!this.setTask(newTask)) {
      console.log('RoomObject at: ' + this.pos + ' failed to find new Task')
      return;
    }
  }
  let taskFinished = this.processTask();
  if(taskFinished) {
    let newTask = this.getNewTask();
    if(!this.setTask(newTask)) {
      console.log('RoomObject at: ' + this.pos + ' failed to find new Task')
      return;
    }
  }

}

RoomObject.prototype.processTask = function() {
  let role = this.getRole();
  return role.processTask(this);
}

RoomObject.prototype.getNewTask = function() {
  let role = this.getRole();
  return role.getNewTask(this);
}


/*
Section 5: Memory Implementations
*/

Object.defineProperty(ConstructionSite.prototype, 'memory', {
  get() {
    if(Memory.constructionSites == null) {
      Memory.constructionSites = {}
    }

    if(Memory.constructionSites[this.id] == null) {
      Memory.constructionSites[this.id] = {}
    }
    return Memory.constructionSites[this.id];
  }
});

Object.defineProperty(Deposit.prototype, 'memory', {
  get() {
    if(Memory.deposits == null) {
      Memory.deposits = {}
    }
    if(Memory.deposits[this.id] == null) {
      Memory.deposits[this.id] = {}
    }
    return Memory.deposits[this.id];
  }
});

Object.defineProperty(Mineral.prototype, 'memory', {
  get() {
    if(Memory.minerals == null) {
      Memory.minerals = {}
    }
    if(Memory.minerals[this.id] == null) {
      Memory.minerals[this.id] = {}
    }
    return Memory.minerals[this.id];
  }
});

Object.defineProperty(Resource.prototype, 'memory', {
  get() {
    if(Memory.resources == null) {
      Memory.resources = {}
    }
    if(Memory.resources[this.id] == null) {
      Memory.resources[this.id] = {}
    }
    return Memory.resources[this.id];
  }
});

Object.defineProperty(Source.prototype, 'memory', {
  get() {
    if(Memory.sources == null) {
      Memory.sources = {}
    }
    if(Memory.sources[this.id] == null) {
      Memory.sources[this.id] = {}
    }
    return Memory.sources[this.id];
  }
});

Object.defineProperty(Structure.prototype, 'memory', {
  get() {
    if(Memory.structures == null) {
      Memory.structures = {}
    }
    if(Memory.structures[this.id] == null) {
      Memory.structures[this.id] = {}
    }
    return Memory.structures[this.id];
  }
});

Object.defineProperty(StructureTower.prototype, 'memory', {
  get() {
    if(Memory.towers == null) {
      Memory.towers = {}
    }
    if(Memory.towers[this.id] == null) {
      Memory.towers[this.id] = {}
    }
    return Memory.towers[this.id];
  }
});

/*
Section 6: Utility Functions
*/

function tryGetClosestEnergyStore(pos) {
  if(pos == null) {
    return null;
  }
  let closestEnergyStore = pos.findClosestByRange(FIND_STRUCTURES, {
    filter: function(structure) {
      if(structure.store == null) {
        return false;
      }
      return !structure.store.isFull(RESOURCE_ENERGY);
    }
  });
  return closestEnergyStore;
}

function getBodyCost(body) {
  if(body.length === 0) {
    return 0;
  }
  let total = 0;
  for(let i = 0; i < body.length; i++) {
    let part = body[i];
    if(part.type != null) {
      total += BODYPART_COST[part.type];
    } else {
      total += BODYPART_COST[part];
    }
  }
  return total;
}
