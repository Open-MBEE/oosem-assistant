package Drive_gb {
    private import RecursiveDecompositionPattern::Metadata::*;
    private import Rover_gb::*;

    #graybox part def Drive_gb :> Drive_bb {
        #blackbox part motor : Motor_bb[4];
    }

    #blackbox part def Motor_bb;
    #graybox part def Motor_gb :> Motor_bb;
}
