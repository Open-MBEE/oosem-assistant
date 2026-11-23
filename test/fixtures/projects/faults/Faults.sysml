package FaultTest {
    private import RecursiveDecompositionPattern::Metadata::*;

    #blackbox part def Pump_bb;

    #blackbox part def Valve_bb {
        #graybox part seat;
    }

    #graybox part def Pump_gb :> Pump_bb {
        #blackbox part housing : Housing_bb;
        #blackbox part rotor : Rotor_bb;
    }
    #blackbox part def Housing_bb;
    #blackbox part def Rotor_bb;

    #graybox part def Valve_gb :> Valve_bb {
        #whitebox stem;
    }
    #graybox part def Pump_spare_gb :> Pump_bb;
    #graybox part def Loose_gb;
    #whitebox part def Loose_wb;

    #graybox part def Housing_gb :> Housing_bb;
    #graybox part def Rotor_gb :> Rotor_bb {
        #blackbox part bearing : Pump_bb;
    }
    #whitebox part def Rotor_wb :> Rotor_gb;

    #whitebox part def Pump_wb :> Pump_gb {
        #graybox part :>> housing : Housing_gb;
        #whitebox part :>> rotor : Rotor_wb;
        #blackbox part spare : Pump_bb;
        #whitebox part extra : Loose_wb;
    }
}
